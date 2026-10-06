# 0009. Long documents: page-aligned map-reduce chunking

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

F-08 (SHOULD): split long text into fragments and merge results. Gemini Flash has a 1M-token
window, so chunking is not needed for _capacity_ below our limits, but it bounds per-call latency
(output tokens grow with input) and keeps the < 30 s target for long documents. Free-tier RPM
limits forbid fan-out to many calls.

## Considered options

1. Never chunk (rely on the 1M window) — ignores F-08, slow on very long inputs.
2. Fixed-size character chunks — splits sentences and tables mid-way; page numbers get lost.
3. **Page-aligned chunks** of ≤ `CHUNK_CHAR_BUDGET` (120 000 chars, ~30k tokens), at most
   `MAX_CHUNKS` (4) calls in parallel, then one **reduce** call.

## Decision

We will use option 3:

- **Single call** when the redacted text fits one chunk (typical documents < ~50 pages).
- **Map**: each chunk is analysed with the same prompt, labelled "fragment i of n".
- **Reduce (deterministic)**: entities, amounts, dates, keywords are unioned and de-duplicated in
  code (`apps/api/src/lib/merge.ts`).
- **Reduce (AI)**: one short call synthesises `summary`, `keyPoints`, `type`, `title`, `date`,
  `language` from the partial results only (not the full text).
- Oversized single pages are split on paragraph boundaries.

## Consequences

- Good: bounded latency and request count (≤ 5 calls); page numbers stay meaningful.
- Bad: cross-chunk context (e.g. a definition on page 2 used on page 80) can be lost in a fragment;
  the AI reduce step sees only partial results. Accepted for an MVP.

## Confirmation

- `apps/api/test/chunking.test.ts` — property tests (fast-check): every page appears in exactly one
  chunk, order preserved, no chunk exceeds the budget unless a single page does (then it is split).
- `apps/api/test/merge.test.ts` — de-duplication rules.
