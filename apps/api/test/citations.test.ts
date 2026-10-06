import { ApiErrorSchema, parseAnalysis, redactSecrets, type AnalyzeRequest } from "@pdf-insight/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizeCitationText, parseCitedExtraction, validateCitations } from "../src/lib/citations";
import type { LlmExtraction } from "../src/lib/llm-schema";
import { mergeLists } from "../src/lib/merge";
import type { PromptPage } from "../src/lib/prompt";
import { extraction, fakeGemini, geminiJson, post, testApp } from "./helpers";

const sourcePages = [
  { number: 1, text: "Pełnomocnictwo Pawła Dąbrowskiego z dnia 2 marca 2026 r." },
  { number: 2, text: "Umowa obowiązuje od 1 kwietnia 2026 r. do 31 marca 2028 r." },
  { number: 3, text: "E1 Analiza przedwdrożeniowa 01.04.2026 30.04.2026" },
  { number: 4, text: "Prace dodatkowe: 240 zł netto za roboczogodzinę." },
  { number: 7, text: "Konsultant biznesowy 240,00 zł" },
  { number: 9, text: "A1 Przesłanie projektu umowy 02.03.2026\nA3 Projekt umowy powierzenia danych 20.03.2026" },
  { number: 11, text: "Aneks nr 1 zawarty w dniu 20 marca 2026 r." },
];
const promptPages: PromptPage[] = sourcePages.map((page) => ({ ...page, text: redactSecrets(page.text).text }));

function mergedContexts(): LlmExtraction {
  return extraction({
    amounts: [{ value: 240, currency: "PLN", context: "stawka za prace dodatkowe / konsultanta biznesowego", page: 4 }],
    dates: [
      { date: "2026-03-02", context: "pełnomocnictwo / termin przesłania projektu umowy", page: 1 },
      { date: "2026-04-01", context: "początek umowy i start etapu E1", page: 2 },
      { date: "2026-03-20", context: "termin zadania A3 / data zawarcia Aneksu nr 1", page: 9 },
    ],
  });
}

function citedContexts(): LlmExtraction {
  return extraction({
    amounts: [{ value: 240, currency: "PLN", context: "Prace dodatkowe: 240 zł netto za roboczogodzinę.", page: 4 }],
    dates: [
      { date: "2026-03-02", context: "Pełnomocnictwo Pawła Dąbrowskiego z dnia 2 marca 2026 r.", page: 1 },
      { date: "2026-04-01", context: "Umowa obowiązuje od 1 kwietnia 2026 r. do 31 marca 2028 r.", page: 2 },
      { date: "2026-03-20", context: "A3 Projekt umowy powierzenia danych 20.03.2026", page: 9 },
    ],
  });
}

describe("page-linked source excerpts", () => {
  it("rejects all four merged contexts found in the saved contract analysis", () => {
    const parsed = parseCitedExtraction(mergedContexts(), promptPages);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("Expected unsupported citations");
    expect(parsed.issues.map((issue) => issue.path)).toEqual([
      "amounts[0].context",
      "dates[0].context",
      "dates[1].context",
      "dates[2].context",
    ]);
    expect(parseCitedExtraction(citedContexts(), promptPages).ok).toBe(true);
  });

  it("rejects a real excerpt copied from a different page", () => {
    const value = extraction({
      amounts: [{ value: 240, currency: "PLN", context: "Konsultant biznesowy 240,00 zł", page: 4 }],
      dates: [],
    });
    expect(parseCitedExtraction(value, promptPages).ok).toBe(false);
  });

  it("restores source spelling and punctuation when the same contiguous word sequence is quoted", () => {
    const result = extraction({
      amounts: [{ value: 240, currency: "PLN", context: "prace dodatkowe - 240 zł netto za roboczogodzinę", page: 4 }],
      dates: [],
    });
    const parsed = parseCitedExtraction(result, promptPages);
    if (!parsed.ok) throw new Error("Expected source excerpt recovery");
    expect(parsed.value.amounts[0]?.context).toBe("Prace dodatkowe: 240 zł netto za roboczogodzinę");
    expect(validateCitations(parsed.value, promptPages)).toEqual([]);
  });

  it("requires the returned value to occur inside the excerpt", () => {
    const value = extraction({
      amounts: [
        { value: 12500, currency: "PLN", context: "Prace dodatkowe: 240 zł netto za roboczogodzinę.", page: 4 },
      ],
      dates: [],
    });
    expect(parseCitedExtraction(value, promptPages).ok).toBe(false);
    const date = extraction({
      amounts: [],
      dates: [{ date: "2026-03-02", context: "Umowa obowiązuje od 1 kwietnia 2026 r.", page: 2 }],
    });
    expect(parseCitedExtraction(date, promptPages).ok).toBe(false);
  });

  it("rejects an excerpt that clips a number out of a larger amount", () => {
    const value = extraction({ amounts: [{ value: 100, currency: "PLN", context: "100 PLN", page: 1 }], dates: [] });
    const pages = [{ number: 1, text: redactSecrets("Abonament 13100 PLN").text }];
    expect(parseCitedExtraction(value, pages).ok).toBe(false);
  });

  it("rejects a citation outside the supplied fragment even when the page number is plausible", () => {
    expect(
      parseCitedExtraction(
        citedContexts(),
        promptPages.filter((page) => page.number !== 9),
      ).ok,
    ).toBe(false);
  });

  it("allows unlinked rows without asserting a verified page", () => {
    const value = extraction({
      amounts: [{ value: 240, currency: "PLN", context: "nieustalona strona", page: null }],
      dates: [],
    });
    expect(parseCitedExtraction(value, promptPages).ok).toBe(true);
  });

  it("preserves OCR, Unicode and whitespace normalization (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.constantFrom(" ", "\n", "\t", "\u00a0"),
        (value, separator) => {
          const text = ["Wynagrodzenie", String(value), "PLN", "miesięcznie"].join(separator);
          const pages = [{ number: 2, text: redactSecrets(text).text }];
          const result = extraction({
            amounts: [{ value, currency: "PLN", context: normalizeCitationText(text), page: 2 }],
            dates: [],
          });
          expect(parseCitedExtraction(result, pages).ok).toBe(true);
        },
      ),
    );
  });

  it("grounds normalized multipliers and split OCR digits inside source excerpts", () => {
    const text = "Przychody 4,2 mln zł rocznie. Abonament 13\n100,00 PLN.";
    const result = extraction({
      amounts: [
        { value: 4200000, currency: "PLN", context: "Przychody 4,2 mln zł rocznie.", page: 11 },
        { value: 13100, currency: "PLN", context: "Abonament 13 100,00 PLN.", page: 11 },
      ],
      dates: [],
    });
    expect(parseCitedExtraction(result, [{ number: 11, text: redactSecrets(text).text }]).ok).toBe(true);
  });

  it("keeps identical excerpts on different pages paired with their original references during merge", () => {
    const first = citedContexts();
    const second = {
      ...first,
      amounts: first.amounts.map((item) => ({ ...item, page: 7 })),
      dates: first.dates.map((item) => ({ ...item, page: 11 })),
    };
    const merged = mergeLists([first, second]);
    expect(merged.amounts.map((item) => item.page)).toEqual([4, 7]);
    expect(merged.dates.map((item) => item.page)).toEqual([1, 2, 9, 11, 11, 11]);
  });
});

describe("citation retry through the API", () => {
  const request: AnalyzeRequest = { fileName: "citation-regression.pdf", pageCount: 12, pages: sourcePages };

  it("retries the four incomplete citations and returns supported excerpts", async () => {
    const gemini = fakeGemini([geminiJson(mergedContexts()), geminiJson(citedContexts())]);
    const { app } = testApp({ fetch: gemini.fetch });
    const response = await post(app, request);
    expect(response.status).toBe(200);
    const parsed = parseAnalysis(await response.json());
    if (!parsed.ok) throw new Error("Expected a validated public result");
    expect(parsed.value.amounts).toEqual(citedContexts().amounts);
    expect(parsed.value.dates).toEqual(citedContexts().dates);
    expect(gemini.calls).toHaveLength(2);
    expect(gemini.calls[1]?.body).toContain("contiguous excerpt from the cited page");
  });

  it("fails after one retry rather than returning misleading page links", async () => {
    const gemini = fakeGemini([geminiJson(mergedContexts())]);
    const { app } = testApp({ fetch: gemini.fetch });
    const response = await post(app, request);
    expect(response.status).toBe(502);
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe("AI_INVALID_RESPONSE");
    expect(gemini.calls).toHaveLength(2);
  });
});
