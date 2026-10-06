# 0018. Validate page-linked amount and date contexts as source excerpts

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** project owner, Codex

## Context

The saved contract analysis returned correct monetary and date values, but four rows combined
facts from separate pages under one page reference. Document-wide numeric/date grounding
cannot establish that the description belongs to the cited page. The owner requested a fix.

## Considered options

1. Strengthen the prompt alone — unsupported descriptions can still pass validation.
2. Add multiple page references — expands the public schema, UI, history and exports while
   still requiring a semantic check of model-written descriptions.
3. Keep the public fields and require cited contexts to quote the source directly, checked
   deterministically before accepting the extraction.

## Decision

We will use option 3, extending the grounding controls in ADR-0015 and the retry in ADR-0005.

- For an amount/date with a non-null page, `context` is one contiguous source excerpt of at
  most 300 characters. Its page must exist in the supplied extraction fragment, its excerpt
  must occur on that page, and the amount/date must occur inside that excerpt.
- Comparison normalizes Unicode NFC and whitespace. If copying changes case or punctuation,
  the server may restore the original excerpt only when the entire word/number sequence occurs
  contiguously on the same cited page. Returned text is always the source excerpt; paraphrases,
  omitted words and passages joined from separate locations remain invalid. The existing
  numeric/date normalization is reused.
- Failed citation checks enter the existing one-retry path. A second invalid answer returns
  `AI_INVALID_RESPONSE`; unsupported page links do not reach the UI.
- Prompts select one occurrence when the same value has different meanings. They never combine
  those meanings into a single cited description. Context/page pairs survive chunk merging;
  deduplication includes the page identity.
- Rows with `page=null` assert no verified location. The existing document-wide presence warnings
  remain available for these rows. Historical saved results are not retrospectively certified.
- Public field names and types stay compatible. Generated schema descriptions document the
  source-excerpt semantics. No extra provider request is added to a successful first answer.

## Consequences

- Good: the complete displayed context of each linked row comes from its linked page; the four
  observed cross-page descriptions are rejected mechanically.
- Accepted trade-off: contexts look like document excerpts rather than polished labels. Citation
  defects can trigger the existing retry or error, increasing latency on invalid answers.
- Accepted limit: this proves excerpt and value presence, not universal semantic correctness,
  currency inference or OCR fidelity. An unlinked row remains unverified. Table excerpts reflect
  the supplied text order.

## Confirmation

- `apps/api/test/citations.test.ts` covers all four audited cases, wrong-page quotes, excerpt/value
  mismatch, fragment bounds, whitespace properties, OCR/multipliers, merge preservation and retry.
- `npm run docs:api` regenerates the public descriptions; generated differences are reviewed.
- `npm run verify`, desktop/mobile e2e, the supplied-contract live smoke and live e2e pass.
