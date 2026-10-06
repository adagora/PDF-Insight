# Requirements traceability

Source: the PDF Insight specification extracted in `markdown_extractions/*.md`.
Every row names the implementation and its verification. Conversion metadata adds no product
requirements. Updated delivery and runtime evidence is recorded below.

## Functional

| ID   | Pri    | Requirement                                                     | Implementation                                                                                                                        | Proof                                                                               |
| ---- | ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| F-01 | MUST   | Drag & drop and file picker; PDF only; ≤ 10 MB                  | `UploadPanel.tsx`, `lib/file-validation.ts` (MIME/extension + `%PDF-` magic bytes)                                                    | `file-validation.test.ts`; e2e "rejects a non-PDF", "renamed .pdf"                  |
| F-02 | MUST   | Text extraction from PDFs with a text layer                     | `lib/pdf.ts` (pdf.js), `shared/pdf-text.ts` (column-aware joining)                                                                    | `pdf-text.test.ts`; live e2e                                                        |
| F-03 | MUST   | 3–5 sentence summary in the document language, nothing invented | Unicode sentence validation at AI/public/history boundaries; reviewed language fixtures; source-page excerpts (ADRs 0018, 0020, 0023) | `analyze.test.ts`; `citations.test.ts`; `npm run smoke`                             |
| F-04 | MUST   | §04 schema, validated before display                            | `shared/schema.ts`; `parseAnalysis` on server and in the browser; `ValidatedAnalysis` proof                                           | `schema.test.ts`; contract tests; e2e "fails schema validation is never displayed"  |
| F-05 | MUST   | Readable results, JSON preview, `.json` download                | `ResultView.tsx`, `JsonPreview.tsx`, `downloadJson`                                                                                   | e2e happy path (download parsed and checked)                                        |
| F-06 | MUST   | Loading, error with retry, empty state                          | `ProgressPanel`, `ErrorPanel`, home empty state                                                                                       | e2e: API error + retry, network failure                                             |
| F-07 | MUST   | Public demo on GitHub Pages                                     | `.github/workflows/ci.yml` (`deploy-pages`), `VITE_BASE`                                                                              | [Live demo](https://adagora.github.io/PDF-Insight/); public smoke and live e2e pass |
| F-08 | SHOULD | Chunk long documents and merge                                  | `chunking.ts`, `merge.ts`, synthesis call (ADR-0009)                                                                                  | `chunking.test.ts` (properties), long-document test                                 |
| F-09 | SHOULD | Recent results in local storage                                 | `lib/history.ts` (Zod-validated on read)                                                                                              | `history.test.ts`; e2e history                                                      |
| F-10 | COULD  | OCR for scans                                                   | Local Tesseract OCR, original images and every rendered page (ADR-0015)                                                               | OCR test; live e2e reads the scanned annex                                          |

## Schema rules (§04)

| Rule                                               | Implementation                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Missing info → `null` / `[]`, model does not guess | prompt rules; nullable fields; grounding warnings; summary/name correctness is not mechanically established                                      |
| ISO 639-1 document language                        | Shared registered ISO 639-1 enum at public and AI boundaries; invalid/unregistered codes rejected (ADR-0020)                                     |
| ISO 8601 dates, ISO 4217 currencies                | `z.iso.date()` at AI and public boundaries; invalid AI dates retry; static ISO 4217 list as Gemini enum + Zod refine                             |
| Invalid AI answer → 1 retry, then error            | `gemini.ts` (`validationRetries`), 502 `AI_INVALID_RESPONSE`                                                                                     |
| English keys, values in the document language      | schema keys; prompt rule                                                                                                                         |
| Fields may be added, not removed                   | additions: `warnings`, `meta`, optional `page` on amounts/dates                                                                                  |
| Linked amount/date context matches its cited page  | `citations.ts` checks a contiguous source excerpt and the value within it; source formatting recovery; one retry on invalid citations (ADR-0018) |

## Standards (§05)

| Area     | Requirement                                                                         | Where                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Code     | TS strict, zero type errors                                                         | `tsconfig.base.json`; `npm run typecheck`                                                                                   |
| Code     | ESLint + Prettier; no `any`, no `console.log`                                       | `eslint.config.js` (strict type-checked); Oxlint plugin                                                                     |
| Code     | `components/ lib/ api/`                                                             | `apps/web/src/`                                                                                                             |
| Git/CI   | Several logical Conventional Commits; lint › build › deploy                         | Conventional Commits; `.github/workflows/ci.yml` gates lint, tests, build and Pages publication                             |
| Git/CI   | `.env.example` committed, `.env` never                                              | `.gitignore`; `check:secrets --history`                                                                                     |
| Security | Gemini key never in frontend code or Git history                                    | Worker secret only (ADR-0019); browser key entry and credential transport removed; `check:secrets`; Worker credential tests |
| Security | CORS limited to the demo domain                                                     | `ALLOWED_ORIGINS` + 403 for other origins                                                                                   |
| Security | Request and size limits                                                             | rate limit binding, `bodyLimit`, `LIMITS`                                                                                   |
| Security | Inspect objects, metadata, original images, OCR, barcodes and attachments before AI | ADR-0015/0016; inspection core, browser adapters, object/PNG parsers; inspection e2e                                        |
| Security | Repeated attachments reuse scoped completed inspection                              | `inspection-cache.ts`; SHA-256/profile/tab scope/TTL/purge tests                                                            |
| Security | PDF content is data (prompt injection)                                              | ADR-0007; detector + model self-report + warning                                                                            |
| Security | No `dangerouslySetInnerHTML`                                                        | ESLint `no-restricted-syntax`                                                                                               |
| Security | Tell the user the file goes to an AI API                                            | privacy note under the drop zone                                                                                            |
| UX       | From 360 px, keyboard, contrast, Polish copy                                        | e2e `mobile-360` project, keyboard tests                                                                                    |
| Tests    | Unit tests of schema validation (Vitest)                                            | `packages/shared/test/schema.test.ts` and more                                                                              |
| Docs     | README, `AI_LOG.md`                                                                 | repo root                                                                                                                   |

## Acceptance and delivery

A visitor opens the demo, uploads a supported PDF, sees the summary and data within 30 seconds,
and downloads schema-valid JSON. Complete inspection remains mandatory: unsupported or incomplete
inputs fail before the API request rather than omit content to meet the timing target.

| Area                       | Implementation and verification                                                                                                                     | Status                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| F-01–F-06, F-09            | File validation, responsive results/export, error/retry, validated history; unit and desktop/360 px browser coverage                                | Implemented                                                                |
| F-03/F-04 boundaries       | Registered language membership; 3–5 actual Unicode sentences; invalid AI output retries once; public/browser/history reject invalid data            | Implemented; ADR-0020                                                      |
| F-07 and public repository | Pages configuration, production API URL and Actions workflow; public smoke and live desktop/mobile checks                                           | Published; Linux CI passes 298 tests and 40 browser checks                 |
| F-08                       | Page-aligned chunks, merging and synthesis; property tests and complete mocked long-document API flow                                               | Implemented; large-document real-provider scaling not established          |
| F-10                       | Local OCR of every rendered page and supported original image; scanned-annex evidence                                                               | Implemented within inspection budgets                                      |
| Reviewed AI quality        | Polish invoice, English offer, German report, French agreement, sparse note and long invoice appendix; exact facts/entities and missing-data checks | PASS: six reviewed real-provider cases; original failures retained         |
| Performance                | 20 browser inspections and 20 API baseline calls; optimizations; 20 fresh public desktop/mobile uploads                                             | Public 20/20 valid; 19/20 under 30 s; p95 29.105 s, maximum 41.013 s       |
| Continuous availability    | Six-hourly public assets, CORS, health and real analysis checks; dated workflow artifacts retained for 30 days                                      | Initial check failed; follow-up passed; 14-day observation remains pending |

## Evidence and limits

The baseline exposed a real latency failure: a 38.7-second smoke, a 38.479-second desktop result
and a mobile API timeout. These are retained in the performance report alongside all candidate
measurements. Final checks exercised the published Pages assets and Worker with native browser
requests and CORS: the supplied-PDF smoke and both live desktop/mobile checks passed. The Linux
[publication workflow](https://github.com/adagora/PDF-Insight/actions/runs/37445721525) passed
298 unit/contract/property tests and 40 browser checks.

Twenty fresh public uploads all returned visible, schema-valid results with valid amount/date
citations, the scanned-annex amount and the injection warning. Nineteen completed within
30 seconds; one took 41.013 seconds. Date counts varied between 28 and 29. The latency target
is therefore not reliably satisfied, and source validity does not establish complete extraction.
The public availability checker initially failed its real-analysis check and passed a later
check. Long-term reliability, distributed abuse controls and a global provider spending cap
remain production-readiness work; publication and passing tests do not establish an SLA.

Sentence validation counts Unicode sentence boundaries, not just array entries. Reviewed fixture
expectations and the scanned contract complement structural checks; they do not prove all possible
summary facts, entity names or languages. Amount/date source excerpts establish value presence and
a truthful source page, not exhaustive extraction or universal currency association. Large chunks
use three concurrent field-group requests, increasing provider input usage (ADRs 0021–0023).

Browser tests use Chromium desktop and 360 px mobile emulation. Physical devices, Safari and
slow networks require additional measurement. OCR is heuristic and slower hardware may exceed
30 seconds. Inspection admits at most 100 pages, while the API accepts up to 500 text pages;
no unmeasured 10/50/100-page or concurrent-user throughput claims are made.

See [performance evidence](performance/2026-10-06/README.md),
[reviewed AI cases](evaluation/README.md), [API contract](api/API.md), and
[deployment instructions](../README.md#deploy).
