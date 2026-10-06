# 0023. Resolve source pages from supported extracted values

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** project owner, Codex

## Context

The reference-only experiment exposed an intermittent model error: 184,500 PLN was assigned to
page 1 even though the supplied text contains it on pages 3, 4 and 8. A correction repeated the
same mistake. The value itself is supported; the Worker already has indexed occurrences and can
establish a truthful public page/context pair without guessing.

## Considered options

1. Reject the whole analysis whenever the model misnumbers a supported value: unnecessary failures.
2. Keep its page and use a quote from another page: misleading citation.
3. Resolve both page and context from an actual occurrence in the supplied fragment.

## Decision

Use option 3. Preserve the model's suggested page when it contains the returned value; otherwise
choose the first supported page in this fragment. Both the public page and excerpt come from
that occurrence. Values absent from the complete fragment still fail and get one correction
retry; failed corrections block the response. No record is silently dropped, computed or invented.

This supersedes ADR-0022's strict rejection of an incorrect suggested page. Its bounded contiguous
windows, source indexing, internal reference schemas and small-document quote validation remain.
The public source-excerpt invariant in ADR-0018 remains: displayed context must contain the value
and occur on the displayed page. The model's proposed page is a hint, not a source proof.

## Consequences

- Good: supported facts survive a model numbering error and retain a verifiable source pair.
- Accepted trade-off: repeated values can have multiple meanings; first-occurrence selection is
  explicit and the excerpt identifies the selected meaning. This does not establish currency
  associations or summary/name correctness beyond the stated checks.
- Accepted trade-off: normalization still depends on extracted/OCR text. Source lookup never
  reaches into another fragment or unsubmitted page.

## Confirmation

Regression tests repair incorrect/out-of-fragment page hints using in-fragment occurrences,
verify every resulting citation and reject absent values. Repeat the 20-call experiment, the
reviewed quality corpus, verification, browser regressions and public scanned-contract checks.
