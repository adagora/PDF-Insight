import type { AnalysisResult } from "../src/schema";

export function validResult(): AnalysisResult {
  return {
    document: {
      fileName: "umowa.pdf",
      pages: 4,
      language: "pl",
      type: "umowa",
      title: "Umowa serwisowa",
      date: "2026-09-01",
    },
    summary:
      "Umowa określa zasady świadczenia usług serwisowych. Strony ustaliły okres umowy na 12 miesięcy. Wynagrodzenie wynosi 12 500,00 zł.",
    keyPoints: ["Okres umowy 12 mies.", "Wynagrodzenie 12 500 zł", "Termin płatności 1 października"],
    entities: { organizations: ["Przykład sp. z o.o."], people: [] },
    amounts: [{ value: 12500, currency: "PLN", context: "wynagrodzenie" }],
    dates: [{ date: "2026-10-01", context: "termin płatności" }],
    keywords: ["serwis", "SLA"],
    warnings: [],
    meta: {
      schemaVersion: "1.0",
      requestId: "3f1b0f5e-8c1a-4d7e-9b2a-1c2d3e4f5a6b",
      model: "gemini-3.8-flash",
      generatedAt: "2026-10-05T12:00:00.000Z",
      durationMs: 9000,
      chunks: 1,
      ocrPages: [],
      redactions: [],
    },
  };
}
