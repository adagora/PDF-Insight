# 0021. Extract large-document facts, amounts and dates concurrently

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** project owner, Codex

## Context

The 20-call baseline has API p50 24.54 s, p95 28.01 s and five timeouts, after browser inspection
p95 16.61 s. Provider output generation dominates; the Node pipeline averages only 43.6 ms CPU.
Changing only the model to Gemini 3.5 reduces typical time but still produces correction failures
and long reasoning tails. Complete local OCR remains required by ADR-0015/0016.

## Considered options

1. Skip inspection or increase the acceptance deadline: contradicts owner policy or the brief.
2. Reduce extracted values to obtain shorter answers: loses document facts.
3. Keep the selected model and inspection; generate independent field groups concurrently.

## Decision

Use option 3 for chunks with at least 12,000 characters. Three concurrent calls extract
(a) document facts, summary and entities, (b) amounts and (c) dates. Small chunks retain one call.
Each group has a Zod-generated Gemini schema and boundary parser. Amount/date groups keep the
same source-page excerpt restoration and verification. Invalid groups use the existing single
correction retry; all groups share the existing 28 s deadline and model/fallback state. A failed
group blocks the complete response. The public schema and map/reduce synthesis remain unchanged.

The source text, nonce-delimited data block, content-free logging, redaction, facts and local
inspection coverage remain the same. This extends ADR-0005/0009's extraction scheduling without
changing their model choice, constrained-output or long-document synthesis policies.

## Consequences

- Good: independent output generation overlaps and leaves time for a smaller correction.
- Good: improving latency does not depend on discarding amounts, dates or inspection work.
- Accepted trade-off: large chunks use up to three times as many input tokens/requests. Provider
  quota and throughput still matter, and four-chunk inputs can make twelve concurrent calls.
- Accepted trade-off: this does not guarantee every admitted document finishes in 30 s. Public
  cold-browser tests and repeated provider measurements remain the acceptance evidence.

## Confirmation

Tests verify concurrency, exact group schemas, same source pages, independent citation retry,
failed-group blocking and map/reduce integration. Compare 20 calls with the baseline, retaining
slow/error samples. Run the reviewed multi-language/type evaluator, real scanned-contract smoke,
public desktop/mobile live tests, verification and browser regressions.
