# 0005. Google Gemini with JSON-schema-constrained output; model chosen by benchmark

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

Any LLM provider is allowed (§03); the owner supplied a `GEMINI_API_KEY`. Results must appear in
< 30 s and match the §04 schema; a bad answer gets exactly one retry (§04 "Zasady").

Benchmark on the 12-page test contract (8.3k prompt tokens, same prompt, JSON schema enforced):

| Model                | Thinking | Latency   | Amounts / dates found | Injection resisted |
| -------------------- | -------- | --------- | --------------------- | ------------------ |
| gemini-2.5-flash     | default  | 33.1 s    | 52 / 33               | yes                |
| gemini-3.5-flash     | low      | 5.5 s     | 6 / 6                 | yes                |
| gemini-3.8-flash     | default  | 17.9 s    | 26 / 28               | yes                |
| **gemini-3.8-flash** | **low**  | **9.3 s** | **25 / 23**           | yes                |
| gemini-flash-latest  | default  | 10.6 s    | 20 / 21               | yes                |

## Considered options

1. Free-text prompting + regex JSON extraction — fragile, frequent retries.
2. Function calling — works, but more ceremony than needed.
3. `generationConfig.responseMimeType = application/json` + `responseJsonSchema` generated from
   our Zod schema (ADR-0006).

## Decision

We will call the Gemini REST API (`generateContent`, no SDK) with `responseJsonSchema`,
`temperature: 0.1` and `thinkingConfig.thinkingLevel: "low"`.

- Primary model `gemini-3.8-flash`; on HTTP 429/5xx we fall back once to `gemini-3.5-flash`
  (faster, sparser extraction). Both are env-configurable.
- The AI returns an **internal** extraction shape (`LlmExtraction`, e.g. `summarySentences[3..5]`
  so the sentence count is structural, not regex-counted); the server maps it to the **public**
  §04 schema.
- Invalid JSON or schema failure → one retry with the validation issues appended → then HTTP 502
  `AI_INVALID_RESPONSE`.
- Invalid ISO calendar dates are schema failures too; they are retried rather than silently
  dropped or converted to missing information.

## Consequences

- Good: ~9 s typical latency, schema-shaped answers, no SDK weight in the Worker.
- Bad: preview-tier model names change; mitigated by env config and the fallback model.
- Bad: Gemini supports only a subset of JSON Schema and fails with a generic HTTP 400 otherwise
  (found by probing: `maxItems: 200` is rejected, `100` accepted). `toGeminiSchema()` whitelists
  keywords and drops `maxItems` > 20; Zod re-checks every constraint on the response.

## Confirmation

- `apps/api/test/analyze.test.ts`: retry-once behaviour, fallback on 429, 502 after two invalid
  answers (Gemini `fetch` is stubbed).
- `npm run smoke` runs the real pipeline against `raw/Test_PDF_Insight_umowa_14-2026.pdf` and
  asserts latency < 30 s.
