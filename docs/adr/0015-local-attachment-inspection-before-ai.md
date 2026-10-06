# 0015. Inspect attachments locally and send only redacted text to AI

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Codex

## Context

The owner requested local inspection of screenshots, PDFs, metadata, barcodes,
OCR output and embedded attachments, with reuse of completed inspection results. Sending scan
images directly to Gemini bypasses text redaction. Browser inspection must finish before any
analysis request is sent, and incomplete inspection must never become a clean verdict.

This record supersedes the attachment handling in ADRs 0003, 0008 and 0010 and the scan-grounding
exception in ADR-0012. Their remaining
controls (client-side PDF decoding, Worker secrets, limits, CORS, content-free logs and numeric/date normalization) remain.

## Considered options

1. Send images to Gemini and redact its OCR response — credentials have already left the device.
2. Deploy a native Rust/Poppler/Tesseract service — a separate hosting and sandboxing
   platform, incompatible with the current static SPA and Worker deployment.
3. Decode and inspect in the browser with pdf.js, pdf-lib, Tesseract.js, ZXing WASM and image metadata
   extraction; transform supported inputs into redacted text and reject incomplete inspection.

## Decision

We will use option 3.

- The browser extracts PDF text, decoded PDF object strings and streams, metadata, annotations, form values, embedded PDF/image/text
  attachments, rendered-page barcodes and local OCR text. Image decoding includes metadata,
  barcodes and OCR. Unsupported attachment types, encryption, active content, excess limits,
  unreadable inputs and failed extraction block the whole request with a fixed Polish message.
- Every rendered PDF page undergoes local OCR and barcode detection. Original embedded JPEG
  and supported decoded raster image streams are separately inspected at their original resolution,
  including unpainted image objects. Unsupported image filters, color spaces and predictors block
  inspection. Object strings and decoded streams are inspected using pdf-lib, not native QPDF.
  Object/metadata and original-image inspection findings are retained as counts; their raw content
  is discarded. Rendered-page text remains the source of document facts. OCR failures
  block forwarding. OCR remains a heuristic; it does not prove that every visible character
  was read correctly. No original pixels or PDF bytes are sent to the API or Gemini.
- Only sanitized text and inspection counts cross the HTTP boundary. Both the browser and
  Worker redact detected credentials. The Worker rejects binary image fields, including
  attempts to bypass browser inspection by calling the API directly.
  Direct API filenames are redacted too. Model-derived partial results are re-redacted before
  synthesis; the synthesis prompt builder also requires the `RedactedText` proof from ADR-0011.
- Metadata is inspected and discarded, rather than used as factual document content. Attachment
  text is labelled as attachment content. Secret-bearing filenames are replaced before transport.
- OCR and barcode workers, WASM and language assets are self-hosted. No third-party OCR service
  receives documents. Rendering, OCR and recursive extraction have count, byte, depth and time
  budgets. Admission fails rather than truncating content or skipping inspection.
  Two local page workers run concurrently; page output stays in document order. This bounds
  concurrency while keeping complete inspection within the supplied contract's performance target.
- A bounded, tab-memory cache binds SHA-256 input bytes to a per-tab scope, inspection profile
  (engine/language/rules/limits versions), and generation. It stores completed sanitized results
  only, expires entries, shares concurrent duplicate work, and never stores raw input or OCR text
  in localStorage. Failed or cancelled work is not cached. Purging advances the generation so an
  older job cannot repopulate the cache. Reloading the tab also clears it.
- The public §04 output fields remain. Additional metadata reports local inspection. OCR-derived
  text participates in grounding, while the UI identifies it as locally read text. An amount or
  date absent from both extracted and OCR text gets the usual missing-value warning, even when
  the document contains scans; the former blanket informational exception no longer applies.

## Consequences

- Good: image credentials cannot bypass text redaction; the complete inspection is a gate before
  inference; repeated inputs avoid OCR while the cache scope and profile match.
- Good: the existing GitHub Pages and Cloudflare Worker architecture is preserved.
- Accepted trade-off: first-use OCR downloads assets and may take longer than 30 seconds on slow
  devices. Cached files and ordinary text PDFs are faster; the supplied contract remains the live
  performance check. Large or unsupported inputs are blocked, with the limit stated to the user.
- Accepted trade-off: browser inspection does not provide a native sandbox, arbitrary remote
  attachment retrieval, forensic erasure or universal secret detection.

## Confirmation

- Unit tests cover decoded object/PNG metadata, unsupported filters and active content,
  cache scope/profile/expiry/purge, failures and cancellation.
- API tests reject image bytes and prove that text from every supported source is redacted before
  Gemini, with no secret-bearing content in logs.
- Browser tests exercise generated screenshot/PDF fixtures with synthetic credentials, QR codes,
  nested embedded attachments, recursion limits and extraction failures; failed inspection causes zero API calls.
- `npm run verify`, desktop and 360 px e2e, real smoke and live e2e pass. Generated API docs are
  regenerated and reviewed for the deliberate request contract change.
