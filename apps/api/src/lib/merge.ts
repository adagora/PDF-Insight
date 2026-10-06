import type { LlmAmount, LlmDate, LlmExtraction } from "./llm-schema";

function normalizeKey(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function uniqueStrings(items: readonly string[], limit = Number.POSITIVE_INFINITY): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.replace(/\s+/g, " ").trim();
    const key = normalizeKey(trimmed);
    if (trimmed.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

export function uniqueAmounts(items: readonly LlmAmount[]): LlmAmount[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${Math.round(item.value * 100)}|${item.currency}|${item.page}|${normalizeKey(item.context)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function uniqueDates(items: readonly LlmDate[]): LlmDate[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.date}|${item.page}|${normalizeKey(item.context)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type MergedLists = {
  readonly organizations: string[];
  readonly people: string[];
  readonly amounts: LlmAmount[];
  readonly dates: LlmDate[];
  readonly keywords: string[];
};

export function mergeLists(parts: readonly LlmExtraction[]): MergedLists {
  return {
    organizations: uniqueStrings(parts.flatMap((p) => p.organizations)),
    people: uniqueStrings(parts.flatMap((p) => p.people)),
    amounts: uniqueAmounts(parts.flatMap((p) => p.amounts)),
    dates: uniqueDates(parts.flatMap((p) => p.dates)),
    keywords: uniqueStrings(
      parts.flatMap((p) => p.keywords),
      15,
    ),
  };
}
