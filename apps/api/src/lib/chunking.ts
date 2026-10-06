import type { RedactedText } from "@pdf-insight/shared";

import type { PromptPage } from "./prompt";

export type Chunk = { readonly pages: readonly PromptPage[]; readonly chars: number };

function splitOversized(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > budget) {
    const window = rest.slice(0, budget);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
    const at = cut > budget / 2 ? cut + 1 : budget;
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

function pack(pages: readonly PromptPage[], budget: number): Chunk[] {
  const chunks: Chunk[] = [];
  let current: PromptPage[] = [];
  let chars = 0;
  const flush = () => {
    if (current.length > 0) chunks.push({ pages: current, chars });
    current = [];
    chars = 0;
  };

  for (const page of pages) {
    const pieces = splitOversized(page.text, budget);
    pieces.forEach((piece) => {
      if (chars + piece.length > budget) flush();
      // SAFETY: a substring of RedactedText stays redacted because splitting happens after redaction (ADR-0011).
      const text = piece as RedactedText;
      const pagePiece: PromptPage = { number: page.number, text };
      current.push(pagePiece);
      chars += piece.length;
    });
  }
  flush();
  return chunks;
}

export function chunkPages(pages: readonly PromptPage[], budget: number, maxChunks: number): Chunk[] {
  let currentBudget = budget;
  for (let round = 0; round < 20; round += 1) {
    const chunks = pack(pages, currentBudget);
    if (chunks.length <= maxChunks) return chunks;
    currentBudget = Math.ceil(currentBudget * 1.25);
  }
  return pack(pages, Number.MAX_SAFE_INTEGER);
}
