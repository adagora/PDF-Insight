# 0003. Extract PDF text in the browser with pdf.js; send text, not the file

- **Status:** Superseded by [0015](0015-local-attachment-inspection-before-ai.md)
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

Flow from the brief: upload → **text extraction** → AI analysis → result. Files up to 10 MB
(F-01). The backend is a Cloudflare Worker with a 10 ms CPU budget on the free plan, and every
byte we forward to the AI provider is a privacy cost. The brief explicitly mentions the pdf.js
worker path as a GitHub Pages pitfall, i.e. client-side extraction is expected.

## Considered options

1. Upload the PDF to the backend and let Gemini read the PDF natively — simplest, handles scans,
   but ships the whole binary (images, metadata, attachments) to a third party and makes the
   backend parse multipart bodies up to 10 MB.
2. Extract text on the backend (pdf.js in a Worker) — CPU-heavy, exceeds free-plan CPU limits.
3. **Extract text in the browser with `pdfjs-dist`**, send only per-page text (+ rendered images
   of pages that have no text layer, see ADR-0010).

## Decision

We will extract text client-side with `pdfjs-dist` running in its module worker
(`pdf.worker.min.mjs` imported via Vite `?url`, so the path honours `base: '/<repo>/'`).
The request body is `{ fileName, pageCount, pages: [{ number, text, image? }] }`.

Rules:

- The browser validates type (MIME/extension **and** `%PDF-` magic bytes) and size (≤ 10 MB)
  before reading the document.
- pdf.js v6 no longer uses `eval` (the `isEvalSupported` option was removed), so the CSP needs no `unsafe-eval`.
- A page whose trimmed text is shorter than `SCAN_PAGE_TEXT_THRESHOLD` counts as a scan.

## Consequences

- Good: small requests (the 12-page test PDF is ~570 KB on disk but ~22 KB of text); metadata
  and embedded files never leave the browser; backend stays cheap and stateless.
- Bad: the backend cannot enforce the 10 MB _file_ limit itself — it enforces request-size,
  page-count and character limits instead (ADR-0008). A malicious client can send arbitrary text,
  which is no worse than any other API client and is covered by rate limiting.

## Confirmation

- `apps/web/test/file-validation.test.ts` covers type/size/magic-byte rejection.
- `apps/api/test/analyze.test.ts` covers server-side size, page and character limits.
- Build check: `npm run build -w apps/web` emits the worker under the configured base path.
