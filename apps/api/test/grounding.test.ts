import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildGroundingIndex,
  collectDates,
  collectNumbers,
  groundAmount,
  groundDate,
  interpretNumber,
  isValidIsoDate,
  toCents,
} from "../src/lib/grounding";

describe("interpretNumber", () => {
  it.each([
    ["184 500,00", [184500]],
    ["184 500,00", [184500]],
    ["1.234,56", [1234.56]],
    ["1,234.56", [1234.56]],
    ["4,2", [4.2]],
    ["99,5", [99.5]],
    ["8 600", [8600]],
    ["1.234", [1.234, 1234]],
    ["12", [12]],
  ])("%s → %j", (token, expected) => {
    expect(interpretNumber(token).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
  });
});

describe("collectNumbers", () => {
  const text = `Wynagrodzenie 184 500,00 zł netto, VAT 42 435,00 zł. Licencje 2 150 EUR (8 600 EUR rocznie).
Hosting 890 USD. Abonament 12 300,00 zł/mies. (295
200,00 zł za 24 miesiące). Wzrost przychodów o 4,2 mln zł. Stawka 1,15 zł/km. Budget $1,250,000.50.`;
  const numbers = collectNumbers(text);

  it.each([184500, 42435, 2150, 8600, 890, 12300, 295200, 4_200_000, 1.15, 1_250_000.5, 24])("contains %s", (value) => {
    expect(numbers.has(toCents(value))).toBe(true);
  });

  it("does not invent numbers", () => {
    expect(numbers.has(toCents(1))).toBe(false);
    expect(numbers.has(toCents(150_000))).toBe(false);
  });

  it("finds any amount formatted the Polish way (property)", () => {
    const pl = new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999_999 }), (cents) => {
        const value = cents / 100;
        return collectNumbers(`Kwota ${pl.format(value)} zł`).has(toCents(value));
      }),
    );
  });
});

describe("collectDates", () => {
  it.each([
    ["zawarta w dniu 12.03.2026 r.", "2026-03-12"],
    ["od 1 kwietnia 2026 r.", "2026-04-01"],
    ["do 31 marca 2028 r.", "2028-03-31"],
    ["Go-live: 12 października 2026", "2026-10-12"],
    ["z dnia 2 marca 2026", "2026-03-02"],
    ["w dniu 20 listopada 2026 r.", "2026-11-20"],
    ["ISO 2026-09-01", "2026-09-01"],
    ["signed on March 12, 2026", "2026-03-12"],
    ["am 3. Juni 2024", "2024-06-03"],
  ])("%s → %s", (text, iso) => {
    expect(collectDates(text).has(iso)).toBe(true);
  });

  it("rejects impossible calendar dates", () => {
    expect(collectDates("31.02.2026").has("2026-02-31")).toBe(false);
  });
});

describe("grounding statuses", () => {
  const index = buildGroundingIndex("Kwota 12 500,00 zł, termin 01.10.2026.", [3]);

  it("grounds values present in the text", () => {
    expect(groundAmount(index, 12500, 1)).toBe("grounded");
    expect(groundDate(index, "2026-10-01", 1)).toBe("grounded");
  });

  it("attributes unmatched values on scan pages (or without page) to OCR", () => {
    expect(groundAmount(index, 13100, 3)).toBe("from-scan");
    expect(groundAmount(index, 13100, null)).toBe("from-scan");
  });

  it("flags unmatched values the model attributes to a text page", () => {
    expect(groundAmount(index, 13100, 1)).toBe("not-found");
    expect(groundAmount(buildGroundingIndex("x", []), 5, null)).toBe("not-found");
  });
});

describe("isValidIsoDate", () => {
  it.each([
    ["2026-03-12", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-3-12", false],
    ["12.03.2026", false],
  ])("%s → %s", (value, expected) => {
    expect(isValidIsoDate(value)).toBe(expected);
  });
});
