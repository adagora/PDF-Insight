import { toSchemaIssues, type ParseOutcome, type SchemaIssue } from "@pdf-insight/shared";

import { normalizeCitationText } from "./citations";
import { collectDates, collectNumbers, toCents } from "./grounding";
import { LlmAmountReferencesSchema, LlmDateReferencesSchema, type LlmExtraction } from "./llm-schema";
import type { PromptPage } from "./prompt";

type PageContexts = { readonly amounts: ReadonlyMap<number, string>; readonly dates: ReadonlyMap<string, string> };
export type SourceContexts = ReadonlyMap<number, PageContexts>;

function excerptAround(source: string, position: number): string {
  const word = /[\p{L}\p{N}]/u;
  let start = Math.max(0, position - 60);
  let end = Math.min(source.length, position + 180);
  while (start < position && word.test(source[start - 1] ?? "")) start += 1;
  while (end > position && word.test(source[end] ?? "")) end -= 1;
  return source.slice(start, end).trim();
}

export function buildSourceContexts(pages: readonly PromptPage[]): SourceContexts {
  const result = new Map<number, PageContexts>();
  for (const page of pages) {
    const amounts = new Map<number, string>();
    const dates = new Map<string, string>();
    const source = normalizeCitationText(page.text);
    for (const match of source.matchAll(/[0-9][0-9.,/-]*/gu)) {
      const context = excerptAround(source, match.index);
      for (const amount of collectNumbers(context)) if (!amounts.has(amount)) amounts.set(amount, context);
      for (const date of collectDates(context)) if (!dates.has(date)) dates.set(date, context);
    }
    result.set(page.number, { amounts, dates });
  }
  return result;
}

function locateContext(index: SourceContexts, page: number | null, read: (source: PageContexts) => string | undefined) {
  if (page !== null) {
    const preferred = index.get(page);
    const context = preferred === undefined ? undefined : read(preferred);
    if (context !== undefined) return { context, page };
  }
  for (const [number, contexts] of index) {
    const context = read(contexts);
    if (context !== undefined) return { context, page: number };
  }
  return null;
}

export function parseReferencedAmounts(
  // oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- decoded provider JSON boundary (ADR-0022)
  input: unknown,
  index: SourceContexts,
): ParseOutcome<Pick<LlmExtraction, "amounts">> {
  const parsed = LlmAmountReferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: toSchemaIssues(parsed.error) };
  const issues: SchemaIssue[] = [];
  const amounts = parsed.data.amounts.flatMap((amount, offset) => {
    const source = locateContext(index, amount.page, (contexts) => contexts.amounts.get(toCents(amount.value)));
    if (source !== null) return [{ ...amount, ...source }];
    issues.push({
      path: `amounts[${offset}].page`,
      message: "The returned amount must occur in the supplied fragment. Do not compute or invent amounts.",
    });
    return [];
  });
  return issues.length === 0 ? { ok: true, value: { amounts } } : { ok: false, issues };
}

export function parseReferencedDates(
  // oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- decoded provider JSON boundary (ADR-0022)
  input: unknown,
  index: SourceContexts,
): ParseOutcome<Pick<LlmExtraction, "dates">> {
  const parsed = LlmDateReferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: toSchemaIssues(parsed.error) };
  const issues: SchemaIssue[] = [];
  const dates = parsed.data.dates.flatMap((date, offset) => {
    const source = locateContext(index, date.page, (contexts) => contexts.dates.get(date.date));
    if (source !== null) return [{ ...date, ...source }];
    issues.push({
      path: `dates[${offset}].page`,
      message:
        "The returned date must occur in the supplied fragment. Do not invent dates or convert relative periods.",
    });
    return [];
  });
  return issues.length === 0 ? { ok: true, value: { dates } } : { ok: false, issues };
}
