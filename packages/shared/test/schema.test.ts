import { describe, expect, it } from "vitest";

import { LIMITS } from "../src/limits";
import {
  AnalysisResultSchema,
  AnalyzeRequestSchema,
  parseAnalysis,
  type AnalysisResult,
  type ValidatedAnalysis,
} from "../src/schema";
import { validResult } from "./fixtures";

function withChange(change: (r: AnalysisResult) => void): AnalysisResult {
  const result = validResult();
  change(result);
  return result;
}

function issuePaths(input: AnalysisResult): string[] {
  const outcome = parseAnalysis(input);
  return outcome.ok ? [] : outcome.issues.map((issue) => issue.path);
}

describe("AnalysisResultSchema (brief §04)", () => {
  it("accepts a complete valid result", () => {
    expect(parseAnalysis(validResult()).ok).toBe(true);
  });

  it("accepts null / [] for missing information (the model does not guess)", () => {
    const result = withChange((r) => {
      r.document.title = null;
      r.document.date = null;
      r.entities = { organizations: [], people: [] };
      r.amounts = [];
      r.dates = [];
      r.keywords = [];
    });
    expect(parseAnalysis(result).ok).toBe(true);
  });

  it.each(["faktura", "umowa", "oferta", "raport", "inne"] as const)("accepts document type %s", (type) => {
    expect(parseAnalysis(withChange((r) => (r.document.type = type))).ok).toBe(true);
  });

  it("rejects a document type outside the enum", () => {
    // SAFETY: deliberately invalid input to exercise runtime validation.
    const result = withChange((r) => (r.document.type = "kontrakt" as AnalysisResult["document"]["type"]));
    expect(issuePaths(result)).toContain("document.type");
  });

  it.each(["zz", "xx", "iw", "in", "bh", "pol", "PL", "p", ""])("rejects non ISO 639-1 language %j", (language) => {
    const outcome = parseAnalysis({ ...validResult(), document: { ...validResult().document, language } });
    expect(outcome.ok ? [] : outcome.issues.map((issue) => issue.path)).toContain("document.language");
  });

  it.each([1, 2, 6])("rejects %i-sentence public summaries", (count) => {
    expect(issuePaths(withChange((r) => (r.summary = "Umowa określa warunki. ".repeat(count))))).toContain("summary");
  });

  it.each([3, 4, 5])("accepts %i-sentence public summaries", (count) => {
    expect(parseAnalysis(withChange((r) => (r.summary = "Umowa określa warunki. ".repeat(count)))).ok).toBe(true);
  });

  it.each(["12.03.2026", "2026-02-30", "2026-13-01", "2026/03/12", "2026-3-1"])(
    "rejects non ISO 8601 date %j",
    (date) => {
      expect(issuePaths(withChange((r) => (r.dates = [{ date, context: "x" }])))).toContain("dates.0.date");
      expect(issuePaths(withChange((r) => (r.document.date = date)))).toContain("document.date");
    },
  );

  const withCurrency = (currency: string) => ({ ...validResult(), amounts: [{ value: 1, currency, context: "x" }] });

  it.each(["zł", "PL", "XYZ", "pln", "EURO"])("rejects non ISO 4217 currency %j", (currency) => {
    const outcome = parseAnalysis(withCurrency(currency));
    expect(outcome.ok ? [] : outcome.issues.map((i) => i.path)).toContain("amounts.0.currency");
  });

  it.each(["PLN", "EUR", "USD", "GBP", "CHF"])("accepts ISO 4217 currency %s", (currency) => {
    expect(parseAnalysis(withCurrency(currency)).ok).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects non-finite amount %s", (value) => {
    expect(issuePaths(withChange((r) => (r.amounts = [{ value, currency: "PLN", context: "x" }])))).toContain(
      "amounts.0.value",
    );
  });

  it("requires 3–7 key points", () => {
    expect(issuePaths(withChange((r) => (r.keyPoints = ["a", "b"])))).toContain("keyPoints");
    expect(issuePaths(withChange((r) => (r.keyPoints = Array.from({ length: 8 }, (_, i) => `p${i}`))))).toContain(
      "keyPoints",
    );
    expect(parseAnalysis(withChange((r) => (r.keyPoints = Array.from({ length: 7 }, (_, i) => `p${i}`)))).ok).toBe(
      true,
    );
  });

  it("rejects an empty summary and blank strings", () => {
    expect(issuePaths(withChange((r) => (r.summary = "   ")))).toContain("summary");
    expect(issuePaths(withChange((r) => (r.entities.people = [""])))).toContain("entities.people.0");
  });

  it("rejects a non-positive or fractional page count", () => {
    expect(issuePaths(withChange((r) => (r.document.pages = 0)))).toContain("document.pages");
    expect(issuePaths(withChange((r) => (r.document.pages = 2.5)))).toContain("document.pages");
  });

  it("requires every top-level key of the brief schema", () => {
    for (const key of ["document", "summary", "keyPoints", "entities", "amounts", "dates", "keywords"] as const) {
      const result = Object.fromEntries(Object.entries(validResult()).filter(([name]) => name !== key));
      expect(AnalysisResultSchema.safeParse(result).success, key).toBe(false);
    }
  });

  it("keeps extra fields out of the validated value but does not fail on them", () => {
    const outcome = parseAnalysis({ ...validResult(), extra: "ignored" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect("extra" in outcome.value).toBe(false);
  });

  it("reports issues with readable paths", () => {
    const outcome = parseAnalysis({ summary: 1 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["document", "summary"]));
  });

  it("brands only parsed values (ADR-0011)", () => {
    // @ts-expect-error — a plain AnalysisResult is not a ValidatedAnalysis; it must go through parseAnalysis.
    const forged: ValidatedAnalysis = validResult();
    expect(forged).toBeDefined();
  });
});

describe("AnalyzeRequestSchema", () => {
  const page = (number: number, text = "Treść strony") => ({ number, text });

  it("accepts a minimal request", () => {
    expect(AnalyzeRequestSchema.safeParse({ fileName: "a.pdf", pageCount: 1, pages: [page(1)] }).success).toBe(true);
  });

  it("rejects duplicate page numbers and pages beyond pageCount", () => {
    expect(AnalyzeRequestSchema.safeParse({ fileName: "a.pdf", pageCount: 2, pages: [page(1), page(1)] }).success).toBe(
      false,
    );
    expect(AnalyzeRequestSchema.safeParse({ fileName: "a.pdf", pageCount: 1, pages: [page(2)] }).success).toBe(false);
  });

  it("enforces the per-page character limit", () => {
    const pages = [page(1, "x".repeat(LIMITS.maxPageChars + 1))];
    expect(AnalyzeRequestSchema.safeParse({ fileName: "a.pdf", pageCount: 1, pages }).success).toBe(false);
  });

  it("rejects all binary image fields", () => {
    const image = { mimeType: "image/jpeg", data: "QUJD" };
    const pages = [{ number: 1, text: "", image }];
    expect(AnalyzeRequestSchema.safeParse({ fileName: "a.pdf", pageCount: pages.length, pages }).success).toBe(false);
    expect(
      AnalyzeRequestSchema.safeParse({
        fileName: "a.pdf",
        pageCount: 1,
        pages: [{ number: 1, text: "", image: { mimeType: "image/jpeg", data: "not base64!" } }],
      }).success,
    ).toBe(false);
  });

  it("rejects an empty file name", () => {
    expect(AnalyzeRequestSchema.safeParse({ fileName: " ", pageCount: 1, pages: [page(1)] }).success).toBe(false);
  });
});
