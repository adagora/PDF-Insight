# 0024. Preserve German ordinal dates during sentence segmentation

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** project owner, Codex

## Context

The real German report fixture failed twice because ICU split the correct sentence
"Das Dokument ist ein Bericht zur Servicequalität der Beispiel GmbH vom 31. Juli 2026."
after the ordinal day. Correction repeated the same valid date. ADR-0020's structural validation
must recognize this ordinary date form while continuing to reject multi-sentence array entries.

## Considered options

1. Relax summary validation: reopens the original sentence-count gap.
2. Require the model to avoid ordinary German date formatting: unnecessary rejection.
3. Tailor the ordinal separator only before a German month name and four-digit year.

## Decision

Use option 3 for the registered German language code. Mask the period after day 1–31 only when
followed by a recognized German month and a four-digit year. Run the same Unicode segmenter on
that validation-only text; the displayed summary remains unchanged. This extends ADR-0020's
existing title-abbreviation tailoring. Actual following sentences still count independently.

## Consequences

- Good: the reproduced valid report is accepted without weakening the three-to-five constraint.
- Limit: this is a narrow language rule, not a general grammar or date-validity proof. The
  structured date fields still use the existing ISO calendar validation.

## Confirmation

Regression tests cover the reproduced sentence, all twelve month names, a following sentence
and the existing invalid sentence-count cases. Repeat the reviewed real-provider corpus and
verification gates. Preserve the failed pre-fix evaluation as evidence.
