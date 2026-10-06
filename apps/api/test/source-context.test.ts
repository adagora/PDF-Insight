import { redactSecrets } from "@pdf-insight/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizeCitationText, validateCitations } from "../src/lib/citations";
import { buildSourceContexts, parseReferencedAmounts, parseReferencedDates } from "../src/lib/source-context";

describe("source contexts for reference-only extraction (ADR-0022)", () => {
  const pages = [
    {
      number: 1,
      text: redactSecrets("Umowa obowiązuje od 1 kwietnia 2026 r. Abonament: 12 500,00 PLN miesięcznie.").text,
    },
    {
      number: 2,
      text: redactSecrets("Aneks z 20.03.2026 zmienia abonament na 13\n100,00 PLN. Przychody 4,2 mln zł.").text,
    },
  ];
  const index = buildSourceContexts(pages);

  it("copies bounded contiguous excerpts and preserves source page/value pairs", () => {
    const amounts = parseReferencedAmounts(
      {
        amounts: [
          { value: 13100, currency: "PLN", page: 2 },
          { value: 4200000, currency: "PLN", page: null },
        ],
      },
      index,
    );
    const dates = parseReferencedDates(
      {
        dates: [
          { date: "2026-04-01", page: 1 },
          { date: "2026-03-20", page: 2 },
        ],
      },
      index,
    );
    if (!amounts.ok || !dates.ok) throw new Error("Expected source-supported records");
    expect(validateCitations({ ...amounts.value, ...dates.value }, pages)).toEqual([]);
    expect(
      amounts.value.amounts.every(
        (item) => item.context.length <= 240 && normalizeCitationText(pages[1]?.text ?? "").includes(item.context),
      ),
    ).toBe(true);
    expect(amounts.value.amounts.map((item) => item.page)).toEqual([2, 2]);
  });

  it("rejects invented values rather than returning incomplete lists", () => {
    expect(parseReferencedAmounts({ amounts: [{ value: 13101, currency: "PLN", page: null }] }, index).ok).toBe(false);
    expect(parseReferencedDates({ dates: [{ date: "2027-01-01", page: null }] }, index).ok).toBe(false);
  });

  it("repairs incorrect suggested pages using actual occurrences in the supplied fragment", () => {
    const amounts = parseReferencedAmounts({ amounts: [{ value: 13100, currency: "PLN", page: 1 }] }, index);
    const dates = parseReferencedDates({ dates: [{ date: "2026-03-20", page: 99 }] }, index);
    if (!amounts.ok || !dates.ok) throw new Error("Expected supported page repair");
    expect(amounts.value.amounts[0]?.page).toBe(2);
    expect(dates.value.dates[0]?.page).toBe(2);
    expect(validateCitations({ ...amounts.value, ...dates.value }, pages)).toEqual([]);
    expect(parseReferencedAmounts({ amounts: [{ value: 184500, currency: "PLN", page: 1 }] }, index).ok).toBe(false);
  });

  it("ignores provider-added contexts and uses only the submitted source", () => {
    const parsed = parseReferencedAmounts(
      { amounts: [{ value: 13100, currency: "PLN", page: 2, context: "FAKE CLAIM" }] },
      index,
    );
    expect(parsed.ok && parsed.value.amounts[0]?.context).not.toContain("FAKE CLAIM");
  });

  it("preserves value containment and complete words across source-window boundaries", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999999 }), fc.integer({ min: 0, max: 100 }), (value, repeats) => {
        const source = [
          {
            number: 1,
            text: redactSecrets(
              `${"Wprowadzenie ".repeat(repeats)}Cena usługi ${value} PLN. ${"Warunki świadczenia usługi. ".repeat(repeats)}`,
            ).text,
          },
        ];
        const parsed = parseReferencedAmounts(
          { amounts: [{ value, currency: "PLN", page: 1 }] },
          buildSourceContexts(source),
        );
        if (!parsed.ok) throw new Error("Expected written amount");
        expect(validateCitations({ ...parsed.value, dates: [] }, source)).toEqual([]);
      }),
    );
  });
});
