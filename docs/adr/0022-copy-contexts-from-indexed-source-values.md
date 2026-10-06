# 0022. Copy source contexts for reference-only value extraction

- **Status:** Superseded by [0023](0023-resolve-source-pages-from-supported-values.md)
- **Date:** 2026-10-06
- **Deciders:** project owner, Codex

## Context

Concurrent extraction reduces ordinary API duration to about 13–16 s, but output quotes still
account for many generated tokens. A wrong date quote caused a 26.3 s correction flow, leaving
insufficient time for mandatory browser inspection. Amounts and dates must carry supported,
readable source contexts; generating those contexts is not necessary to establish their origin.

## Considered options

1. Remove public contexts: contradicts §04 and loses useful evidence.
2. Accept model paraphrases: weakens the source checks in ADR-0018.
3. Request values and page references; copy a bounded source excerpt in the Worker.

## Decision

Use option 3 in ADR-0021's concurrent amount/date groups. Their internal schemas omit context.
The Worker indexes normalized source windows of at most 240 characters around numeric mentions,
using the existing number/date normalization. Windows start/end on complete words. Each returned
value must have a written occurrence on its cited page. If the page is null, the first supplied
page with a supported occurrence establishes the reference. Unsupported values/pages are schema
failures and follow the same single correction retry; the complete response is blocked if
correction fails. Arrays are not silently filtered.

The first supported occurrence on that page supplies a contiguous public context. It may include
surrounding table cells or adjacent facts; it does not claim that repeated values have only one
meaning. Source-derived formatting and value containment uphold ADR-0018. Small-document full
extraction still validates/restores the model's own quote through the existing parser.

## Consequences

- Good: public contexts are copied from the submitted page, with fewer provider output tokens.
- Good: invalid model paraphrases cannot become displayed contexts; invented values fail.
- Accepted trade-off: the excerpt can be broader than a human-selected quote, and the first
  occurrence can describe a different use of a repeated value. It remains visible and verifiable.
- Accepted trade-off: source normalization remains heuristic, including OCR. This does not prove
  monetary currency associations, every summary fact or names beyond the existing checks.

## Confirmation

Property tests check source containment, word boundaries and normalized numeric mentions. Tests
cover split OCR digits, multipliers, date formats, missing/wrong pages, provider-added contexts
and blocking unsupported values. The real contract smoke rechecks every published citation.
Compare 20 provider calls with the previous scheduling-only candidate; repeat live and public
browser acceptance checks and the reviewed language/type corpus.
