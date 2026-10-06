# 0012. Ground extracted amounts and dates against the source text

- **Status:** Superseded by [0015](0015-local-attachment-inspection-before-ai.md)
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

F-03/§04: "bez zmyślonych informacji", "Model nie zgaduje". Schema validation proves the _shape_
is right, not that the _values_ came from the document. Every extracted number and date must
exist in the source. Missing values must remain empty rather than be inferred from a file name.
These requirements can be checked deterministically.

## Considered options

1. Trust the model — hallucinated amounts would be indistinguishable from real ones.
2. Ask a second model to verify — doubles latency and cost.
3. **Deterministic grounding**: normalise every number and date that appears in the source text,
   then check each extracted value against that set.

## Decision

We will run `verifyGrounding()` (`apps/api/src/lib/grounding.ts`) on every result:

- Numbers: parse PL/EN/DE formats (`184 500,00`, `1.234,56`, `1,234.56`, NBSP/thin-space
  separators) and multipliers (`tys.`, `mln`, `mld`, `k`, `million`). An amount is grounded when
  its value (to the cent) is in the set.
- Dates: parse `DD.MM.YYYY`, `YYYY-MM-DD`, `DD/MM/YYYY`, `D <month> YYYY` with Polish (genitive and
  nominative), English and German month names.
- Ungrounded items are **kept but flagged**: warning `AMOUNT_NOT_IN_TEXT` / `DATE_NOT_IN_TEXT` with
  a JSON path (`amounts[3]`). When the document has OCR pages, an ungrounded item is reported as
  `VALUE_FROM_SCAN` (informational) instead — it may legitimately come from an image.
- The UI marks flagged rows so the user knows what to double-check.

## Consequences

- Good: hallucinations become visible; no extra AI call; < 1 ms on typical documents.
- Bad: values the model legitimately _computes_ (e.g. a sum) are flagged; that is the desired
  behaviour under "model nie zgaduje".

## Confirmation

- `apps/api/test/grounding.test.ts` — number/date normalisation tables and property tests.
