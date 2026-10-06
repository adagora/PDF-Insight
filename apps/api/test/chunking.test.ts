import type { RedactedText } from "@pdf-insight/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { chunkPages } from "../src/lib/chunking";
import type { PromptPage } from "../src/lib/prompt";

// SAFETY: test input; redaction is irrelevant to chunking invariants.
const asPage = (number: number, text: string): PromptPage => ({ number, text: text as RedactedText });

const pagesArb = fc
  .array(fc.string({ minLength: 0, maxLength: 400, unit: fc.constantFrom("a", " ", "\n", ".", "ż") }), {
    minLength: 1,
    maxLength: 30,
  })
  .map((texts) => texts.map((text, i) => asPage(i + 1, text)));

describe("chunkPages (ADR-0009)", () => {
  it("keeps every character of every page, in order (property)", () => {
    fc.assert(
      fc.property(
        pagesArb,
        fc.integer({ min: 20, max: 2_000 }),
        fc.integer({ min: 1, max: 6 }),
        (pages, budget, maxChunks) => {
          const chunks = chunkPages(pages, budget, maxChunks);
          const rebuilt = new Map<number, string>();
          const order: number[] = [];
          for (const piece of chunks.flatMap((c) => c.pages)) {
            rebuilt.set(piece.number, (rebuilt.get(piece.number) ?? "") + piece.text);
            if (order.at(-1) !== piece.number) order.push(piece.number);
          }
          expect(order).toEqual(pages.map((p) => p.number));
          for (const p of pages) expect(rebuilt.get(p.number)).toBe(p.text);
        },
      ),
    );
  });

  it("never exceeds maxChunks (property)", () => {
    fc.assert(
      fc.property(
        pagesArb,
        fc.integer({ min: 20, max: 2_000 }),
        fc.integer({ min: 1, max: 6 }),
        (pages, budget, maxChunks) => {
          expect(chunkPages(pages, budget, maxChunks).length).toBeLessThanOrEqual(maxChunks);
        },
      ),
    );
  });

  it("returns one chunk when everything fits", () => {
    const chunks = chunkPages([asPage(1, "abc"), asPage(2, "def")], 100, 4);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.chars).toBe(6);
  });

  it("splits an oversized page on paragraph boundaries and preserves its page number", () => {
    const text = `${"a".repeat(60)}\n\n${"b".repeat(60)}`;
    const chunks = chunkPages([asPage(1, text)], 80, 4);
    const pieces = chunks.flatMap((c) => c.pages);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.number === 1)).toBe(true);
    expect(pieces[0]?.text.endsWith("\n")).toBe(true);
  });
});
