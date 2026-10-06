# 0016. Admit complete inspection trees and separate core policy from browser adapters

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Codex

## Context

The architecture review reproduced two omissions: inline images received only rendered-page OCR,
and an embedded PDF referenced solely through an associated-files (`AF`) array was not recursively
inspected. Attachment byte limits reset per PDF. React owned workflow rules and reconstructed
progress from page numbers that could move backwards during concurrent or nested inspection.

This extends ADR-0015 without changing its local inspection and text-only proxy decision.

## Considered options

1. Move inspection to the proxy — originals would leave the device and require another runtime.
2. Add isolated checks to the existing coordinator — leaves resource accounting and UI rules coupled.
3. Separate admission and execution in a testable core, with browser decoding and OCR adapters.

## Decision

We will use option 3.

- PDF object inspection discovers every embedded-file stream and file specification, including
  name-tree, associated-file and annotation references. Stream identity removes duplicate aliases
  within a PDF. Orphan streams are inspected when their format can be identified; otherwise the
  request is blocked. External file references are unsupported and blocked, never retrieved.
- Original supported inline raster images are decoded separately. Ambiguous or unsupported inline
  encodings block inspection. Rendered-page OCR still runs on every page.
- A single admission budget covers the complete tree: depth, attachment count and bytes, pages,
  original images and decoded bytes. Discovery finishes before OCR starts. Cached subtree results
  are reused only after their tree has passed admission; completed caches contain sanitized results
  only. Cache generations propagate into child work so clearing the cache prevents older trees from
  repopulating it, including when clearing overlaps attachment hashing. Decoding itself remains
  subject to decoder-level bounds and the common deadline.
- The core accepts decoding, OCR and cache ports. Browser adapters hide canvas, workers and library
  objects. Core admission, result composition and workflow rules can be tested with no React or IO.
- Progress reports completed work against a fixed total after admission. Discovery is indeterminate;
  page numbers describe location rather than percentage. OCR provenance includes every OCR-read page.
- A framework-independent workflow owns cancellation, retries and request construction. React binds
  that workflow to IO and renders its state. Error policy types live outside translated messages.
- The proxy continues to validate and re-redact text. Client inspection diagnostics do not attest
  that a caller inspected an original PDF.

## Consequences

- Good: the reproduced omissions and per-parent admission loophole are closed.
- Good: state transitions, cancellation and resource policy have fast deterministic tests.
- Accepted trade-off: an uncached tree is decoded before OCR, retaining bounded transient decoder
  resources. Cached attachments avoid OCR but may still require discovery for tree admission.
- Accepted trade-off: native QPDF parity, forensic binary rewriting and universal OCR/secret
  recognition remain outside the supported browser inspection contract.

## Confirmation

- Unit tests cover associated/orphan/aliased embedded files, inline raster parsing, shared budgets,
  admission before OCR, cache reuse, progress and workflow cancellation/retry rules.
- Browser regressions cover associated and annotation PDF attachments, inline images, unsupported
  encodings and zero API calls on admission failures, on desktop and 360 px.
- `npm run verify`, `npm run test:e2e`, the supplied-PDF smoke and live desktop/mobile e2e pass.
