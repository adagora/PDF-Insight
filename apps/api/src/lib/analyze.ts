import {
  LIMITS,
  SCHEMA_VERSION,
  completeSentence,
  parseAnalysis,
  redactSecrets,
  type AnalysisResult,
  type AnalysisWarning,
  type AnalyzeRequest,
  type ValidatedAnalysis,
} from "@pdf-insight/shared";

import { chunkPages, type Chunk } from "./chunking";
import { normalizeCitationText } from "./citations";
import { AppError } from "./errors";
import { extractChunk } from "./extraction";
import type { GenerationClient, ModelState } from "./generation";
import { buildGroundingIndex, groundAmount, groundDate } from "./grounding";
import { detectInjection } from "./injection";
import {
  LlmSynthesisSchema,
  parseLlmSynthesis,
  toGeminiSchema,
  type LlmExtraction,
  type LlmSynthesis,
} from "./llm-schema";
import { mergeLists } from "./merge";
import { SYNTHESIS_INSTRUCTION, buildSynthesisParts, type PromptPage } from "./prompt";
import { warning } from "./warnings";

const SYNTHESIS_SCHEMA = toGeminiSchema(LlmSynthesisSchema);

export type AnalyzeDeps = {
  readonly gemini: GenerationClient;
  readonly primaryModel: string;
  readonly now: () => number;
  readonly requestId: string;
  readonly nonce: string;
  readonly signal: AbortSignal;
};

function stripControlCharacters(text: string, keepLineBreaks: boolean): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const isBreak = code === 0x09 || code === 0x0a || code === 0x0d;
    if ((code >= 0x20 && code !== 0x7f) || (keepLineBreaks && isBreak)) out += char;
  }
  return out;
}

export function normalizeText(text: string): string {
  return stripControlCharacters(text, true)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const clean = stripControlCharacters(base, false).trim().slice(0, 255);
  return clean.length > 0 ? clean : "dokument.pdf";
}

function nonEmpty(text: string | null): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function pageRange(chunk: Chunk): string {
  const first = chunk.pages[0]?.number ?? 0;
  const last = chunk.pages.at(-1)?.number ?? first;
  return first === last ? `${first}` : `${first}-${last}`;
}

export async function analyzeDocument(request: AnalyzeRequest, deps: AnalyzeDeps): Promise<ValidatedAnalysis> {
  const started = deps.now();
  const totalChars = request.pages.reduce((sum, page) => sum + page.text.length, 0);
  if (totalChars > LIMITS.maxTotalChars) throw new AppError("DOCUMENT_TOO_LONG");

  const redactionCounts = new Map<string, number>();
  for (const finding of request.inspection?.redactions ?? []) redactionCounts.set(finding.kind, finding.count);
  const fileName = redactSecrets(request.fileName);
  for (const finding of fileName.findings)
    redactionCounts.set(finding.kind, (redactionCounts.get(finding.kind) ?? 0) + finding.count);
  const pages: PromptPage[] = [...request.pages]
    .sort((a, b) => a.number - b.number)
    .map((page) => {
      const { text, findings } = redactSecrets(normalizeText(page.text));
      for (const { kind, count } of findings) redactionCounts.set(kind, (redactionCounts.get(kind) ?? 0) + count);
      return { number: page.number, text };
    });

  const ocrPages = request.pages.filter((page) => page.source === "ocr").map((page) => page.number);
  const fullText = pages.map((p) => p.text).join("\n\n");
  if (fullText.trim().length === 0) throw new AppError("NO_TEXT_LAYER");

  const injections = detectInjection(pages);

  const chunks = chunkPages(pages, LIMITS.chunkCharBudget, LIMITS.maxChunks);
  const state: ModelState = { model: deps.primaryModel, usedFallback: false };
  const extractions: LlmExtraction[] = await Promise.all(
    chunks.map((chunk, index) =>
      extractChunk(chunk, chunks.length > 1 ? { index, total: chunks.length } : null, deps, state),
    ),
  );

  const lists = mergeLists(extractions);
  let synthesis: LlmSynthesis;
  const [single] = extractions;
  if (extractions.length === 1 && single !== undefined) {
    synthesis = single;
  } else {
    const partials = extractions.map((e, i) => ({
      fragment: i + 1,
      pages: pageRange(chunks[i] ?? { pages: [], chars: 0 }),
      language: e.language,
      type: e.type,
      title: e.title,
      date: e.date,
      summarySentences: e.summarySentences,
      keyPoints: e.keyPoints,
      keywords: e.keywords,
      injectionDetected: e.injectionDetected,
      injectionExcerpt: e.injectionExcerpt,
    }));
    const redactedPartials = redactSecrets(JSON.stringify(partials));
    for (const finding of redactedPartials.findings)
      redactionCounts.set(finding.kind, (redactionCounts.get(finding.kind) ?? 0) + finding.count);
    synthesis = await deps.gemini.generate(
      {
        systemInstruction: SYNTHESIS_INSTRUCTION,
        parts: buildSynthesisParts(redactedPartials.text, deps.nonce),
        responseSchema: SYNTHESIS_SCHEMA,
        parse: parseLlmSynthesis,
        signal: deps.signal,
      },
      state,
    );
  }

  const validPage = (page: number | null) => (page !== null && page <= request.pageCount ? page : null);
  const amounts = lists.amounts.map((a) => ({
    value: a.value,
    currency: a.currency,
    context: normalizeCitationText(a.context),
    page: validPage(a.page),
  }));
  const dates = lists.dates.map((d) => ({
    date: d.date,
    context: normalizeCitationText(d.context),
    page: validPage(d.page),
  }));
  const documentDate = synthesis.date;

  const warnings: AnalysisWarning[] = [];
  for (const finding of injections) {
    warnings.push(warning("PROMPT_INJECTION_SUSPECTED", { page: finding.page, excerpt: finding.excerpt }));
  }
  const modelReportedInjection = synthesis.injectionDetected || extractions.some((e) => e.injectionDetected);
  if (modelReportedInjection && injections.length === 0) {
    const excerpt =
      synthesis.injectionExcerpt ?? extractions.find((e) => e.injectionExcerpt !== null)?.injectionExcerpt ?? null;
    warnings.push(warning("PROMPT_INJECTION_SUSPECTED", excerpt === null ? {} : { excerpt: excerpt.slice(0, 200) }));
  }
  if (redactionCounts.size > 0) {
    warnings.push(warning("SECRETS_REDACTED", { kinds: [...redactionCounts.keys()] }));
  }
  if (ocrPages.length > 0) warnings.push(warning("OCR_PAGES", { pages: ocrPages }));
  if (chunks.length > 1) warnings.push(warning("DOCUMENT_CHUNKED", { count: chunks.length }));
  if (state.usedFallback) warnings.push(warning("FALLBACK_MODEL", { model: state.model }));

  const index = buildGroundingIndex(fullText, []);
  amounts.forEach((a, i) => {
    const status = groundAmount(index, a.value, a.page);
    if (status === "not-found") warnings.push(warning("AMOUNT_NOT_IN_TEXT", { path: `amounts[${i}]`, amount: a }));
    if (status === "from-scan") warnings.push(warning("VALUE_FROM_SCAN", { path: `amounts[${i}]` }));
  });
  dates.forEach((d, i) => {
    const status = groundDate(index, d.date, d.page);
    if (status === "not-found") warnings.push(warning("DATE_NOT_IN_TEXT", { path: `dates[${i}]`, date: d.date }));
    if (status === "from-scan") warnings.push(warning("VALUE_FROM_SCAN", { path: `dates[${i}]` }));
  });
  if (documentDate !== null && groundDate(index, documentDate) === "not-found") {
    warnings.push(warning("DATE_NOT_IN_TEXT", { path: "document.date", date: documentDate }));
  }

  const result: AnalysisResult = {
    document: {
      fileName: fileName.findings.length > 0 ? "dokument.pdf" : sanitizeFileName(fileName.text),
      pages: request.pageCount,
      language: synthesis.language,
      type: synthesis.type,
      title: nonEmpty(synthesis.title),
      date: documentDate,
    },
    summary: synthesis.summarySentences.map(completeSentence).join(" "),
    keyPoints: synthesis.keyPoints.map((p) => p.replace(/\s+/g, " ").trim()),
    entities: { organizations: lists.organizations, people: lists.people },
    amounts,
    dates,
    keywords:
      synthesis === single ? lists.keywords : [...new Set([...synthesis.keywords, ...lists.keywords])].slice(0, 15),
    warnings,
    meta: {
      schemaVersion: SCHEMA_VERSION,
      requestId: deps.requestId,
      model: state.model,
      generatedAt: new Date(deps.now()).toISOString(),
      durationMs: Math.max(0, Math.round(deps.now() - started)),
      chunks: chunks.length,
      ocrPages,
      redactions: [...redactionCounts.entries()].map(([kind, count]) => ({ kind, count })),
    },
  };
  if (request.inspection !== undefined) result.meta.inspection = request.inspection;

  const validated = parseAnalysis(result);
  if (!validated.ok) throw new AppError("AI_INVALID_RESPONSE", "final_schema", validated.issues);
  return validated.value;
}
