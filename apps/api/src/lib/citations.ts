import { toSchemaIssues, type ParseOutcome, type SchemaIssue } from "@pdf-insight/shared";

import { collectDates, collectNumbers, toCents } from "./grounding";
import { LlmAmountsSchema, LlmDatesSchema, parseLlmExtraction, type LlmExtraction } from "./llm-schema";
import type { PromptPage } from "./prompt";

export function normalizeCitationText(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function excerptAppears(source: string, excerpt: string): boolean {
  if (excerpt.length === 0) return false;
  let index = source.indexOf(excerpt);
  const wordCharacter = /[\p{L}\p{N}]/u;
  while (index !== -1) {
    const startsInsideWord = wordCharacter.test(excerpt[0] ?? "") && wordCharacter.test(source[index - 1] ?? "");
    const endsInsideWord =
      wordCharacter.test(excerpt.at(-1) ?? "") && wordCharacter.test(source[index + excerpt.length] ?? "");
    if (!startsInsideWord && !endsInsideWord) return true;
    index = source.indexOf(excerpt, index + 1);
  }
  return false;
}

function sourceExcerpt(source: string, context: string): string | null {
  const excerpt = normalizeCitationText(context);
  if (excerptAppears(source, excerpt)) return excerpt;
  const words = [...excerpt.matchAll(/[\p{L}\p{N}]+/gu)].map((word) => word[0].toLocaleLowerCase());
  if (words.length === 0) return null;
  const sourceWords = [...source.matchAll(/[\p{L}\p{N}]+/gu)];
  for (let index = 0; index <= sourceWords.length - words.length; index += 1) {
    if (!words.every((word, offset) => sourceWords[index + offset]?.[0].toLocaleLowerCase() === word)) continue;
    const first = sourceWords[index];
    const last = sourceWords[index + words.length - 1];
    if (first === undefined || last === undefined) continue;
    const matched = source.slice(first.index, last.index + last[0].length);
    if (matched.length <= 300) return matched;
  }
  return null;
}

export function validateCitations(
  extraction: Pick<LlmExtraction, "amounts" | "dates">,
  pages: readonly PromptPage[],
): SchemaIssue[] {
  const texts = new Map<number, string>();
  for (const page of pages) {
    texts.set(page.number, normalizeCitationText(`${texts.get(page.number) ?? ""} ${page.text}`));
  }
  const issues: SchemaIssue[] = [];
  const check = (path: string, page: number | null, context: string, containsValue: boolean) => {
    if (page === null) return;
    const source = texts.get(page);
    const excerpt = normalizeCitationText(context);
    if (source === undefined) {
      issues.push({ path: `${path}.page`, message: "Cite a page supplied in this fragment, or use null." });
    } else if (!excerptAppears(source, excerpt)) {
      issues.push({
        path: `${path}.context`,
        message: "Copy one contiguous excerpt from the cited page. Do not paraphrase or combine separate passages.",
      });
    } else if (!containsValue) {
      issues.push({ path: `${path}.context`, message: "The cited excerpt must contain the returned amount or date." });
    }
  };
  extraction.amounts.forEach((item, index) => {
    check(
      `amounts[${index}]`,
      item.page,
      item.context,
      collectNumbers(normalizeCitationText(item.context)).has(toCents(item.value)),
    );
  });
  extraction.dates.forEach((item, index) => {
    check(`dates[${index}]`, item.page, item.context, collectDates(normalizeCitationText(item.context)).has(item.date));
  });
  return issues;
}

// oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- parses decoded provider JSON at the I/O boundary
export function parseCitedExtraction(input: unknown, pages: readonly PromptPage[]): ParseOutcome<LlmExtraction> {
  const parsed = parseLlmExtraction(input);
  if (!parsed.ok) return parsed;
  const restored = restoreCitations(parsed.value, pages);
  const issues = validateCitations(restored, pages);
  return issues.length === 0 ? { ok: true, value: { ...parsed.value, ...restored } } : { ok: false, issues };
}

function restoreCitations(extraction: Pick<LlmExtraction, "amounts" | "dates">, pages: readonly PromptPage[]) {
  const sources = new Map<number, string>();
  for (const page of pages)
    sources.set(page.number, normalizeCitationText(`${sources.get(page.number) ?? ""} ${page.text}`));
  const restore = (context: string, page: number | null) => {
    const source = page === null ? undefined : sources.get(page);
    return source === undefined ? context : (sourceExcerpt(source, context) ?? context);
  };
  return {
    amounts: extraction.amounts.map((item) => ({ ...item, context: restore(item.context, item.page) })),
    dates: extraction.dates.map((item) => ({ ...item, context: restore(item.context, item.page) })),
  };
}

export function parseCitedAmounts(
  // oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- decoded provider JSON boundary (ADR-0021)
  input: unknown,
  pages: readonly PromptPage[],
): ParseOutcome<Pick<LlmExtraction, "amounts">> {
  const parsed = LlmAmountsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: toSchemaIssues(parsed.error) };
  const restored = restoreCitations({ amounts: parsed.data.amounts, dates: [] }, pages);
  const issues = validateCitations(restored, pages);
  return issues.length === 0 ? { ok: true, value: { amounts: restored.amounts } } : { ok: false, issues };
}

export function parseCitedDates(
  // oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- decoded provider JSON boundary (ADR-0021)
  input: unknown,
  pages: readonly PromptPage[],
): ParseOutcome<Pick<LlmExtraction, "dates">> {
  const parsed = LlmDatesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: toSchemaIssues(parsed.error) };
  const restored = restoreCitations({ amounts: [], dates: parsed.data.dates }, pages);
  const issues = validateCitations(restored, pages);
  return issues.length === 0 ? { ok: true, value: { dates: restored.dates } } : { ok: false, issues };
}
