# 0020. Validate registered language codes and summary sentence boundaries

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** project owner, Codex

## Context

The audit reproduced `zz` as an accepted ISO language code, one-sentence public summaries,
and six-sentence AI summaries represented as three array entries. F-03 and §04 require registered
ISO 639-1 codes and three to five sentences. This strengthens the structural sentence-array
claim in ADR-0005; its model, retry and fallback decisions remain unchanged.

## Considered options

1. Count punctuation with a regular expression: splits decimals, dates and legal abbreviations.
2. Trust three to five array entries: each entry can contain several sentences.
3. Share a registered-code enum and Unicode sentence segmentation across AI, API and browser boundaries.

## Decision

We will use option 3. The enum contains the 183 alpha-2 codes in the
[Library of Congress table](https://www.loc.gov/standards/iso639-2/php/code_list.php), checked
on 2026-10-06. Deprecated aliases and unregistered codes fail validation.

`Intl.Segmenter` implements Unicode sentence boundaries, using the document locale when available
and `und` otherwise. Prefix titles such as Dr., prof. and Mme. are protected before a following
word. Dates, decimals and legal abbreviations use the Unicode segmentation rules. Each AI entry
must contain one sentence; the joined, punctuation-completed summary must contain three to five.
The same joined-summary constraint applies to public API responses, browser display and history.
Invalid AI output follows the existing single validation retry.

## Consequences

- Good: the reproduced boundary gaps close without ASCII-only punctuation counting.
- Accepted trade-off: sentence segmentation is a documented heuristic, not a grammar or factual
  correctness proof. Ambiguous abbreviations may require the model to rewrite the sentence after
  validation feedback. Registered language codes do not prove the prose uses that language.
- Accepted trade-off: previously stored invalid summaries are discarded by normal history parsing.

## Confirmation

Shared tests cover registered codes, one/two/six sentences, decimals, dates, legal names,
title abbreviations and Japanese/Chinese punctuation. API tests cover correction on retry and
repeated invalid output. History tests reject tampered sentence and language values.
Regenerate and review `docs/api/*`; run verification, browser tests and live AI checks.
