# 0010. OCR for pages without a text layer via Gemini vision

- **Status:** Superseded by [0015](0015-local-attachment-inspection-before-ai.md)
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

F-10 (COULD): scans without a text layer. Page 11 of the test contract is a scanned annex
(_Aneks nr 1_) that changes the monthly fee from 2027-04-01 and the user count — ignoring it
produces a materially wrong analysis. Pages must be classified as digital or scanned before
choosing an extractor.

## Considered options

1. Tesseract.js in the browser — ~10 MB of WASM + language data, slow on phones, Polish
   diacritics need the `pol` model.
2. **Render scan pages to JPEG in the browser and let Gemini read them** in the same analysis
   call (multimodal input).
3. Skip scans with a warning only.

## Decision

We will use option 2:

- During extraction, a page is a **scan** when its trimmed text is shorter than
  `SCAN_PAGE_TEXT_THRESHOLD` (20 chars).
- Up to `MAX_OCR_PAGES` (5) scan pages are rendered with pdf.js to canvas at ~1600 px width, JPEG
  quality 0.8, and sent as `pages[i].image` (base64).
- The worker attaches them as `inline_data` parts labelled with their page number, inside the same
  nonce-delimited document block (ADR-0007) — image text is data too.
- `meta.ocrPages` lists OCR'd pages; extra scan pages beyond the limit produce warning
  `SCAN_PAGES_SKIPPED`. A document with no text and no OCR-able page fails with `NO_TEXT_LAYER`.

## Consequences

- Good: no extra client dependency; one round trip; the test annex is read.
- Bad: image bytes go to the AI provider (covered by the upload notice); values read from images
  cannot be grounded against a text layer (ADR-0012 marks them as OCR-sourced, not unverified).

## Confirmation

- `apps/web/test/extraction.test.ts` — scan classification threshold.
- `npm run smoke` — the result mentions the annex values (13 100 PLN, 135 users) from page 11.
