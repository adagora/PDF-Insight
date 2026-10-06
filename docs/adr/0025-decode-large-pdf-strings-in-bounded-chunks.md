# 0025. Decode large PDF strings in bounded chunks

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** project owner, Codex

## Context

The Linux browser regression blocked a supported inline image before OCR. A direct check on
its generated PDF exposed a stack overflow in PDF string decoding: image bytes interpreted as
a string span produced too many arguments to a single character-conversion call. Large genuine
object strings can hit the same limit. Platform-dependent argument limits are not an inspection
budget and must not truncate otherwise admitted input.

## Considered options

1. Skip the failing image or oversized string: weakens complete inspection.
2. Increase engine stack size: unavailable for ordinary browsers and still platform-dependent.
3. Decode PDFDocEncoding in small byte chunks and UTF-16 with the standard text decoder.

## Decision

Use option 3 for literal and hexadecimal strings in object and decoded-stream inspection.
Retain the existing PDF escape-to-byte parsing, then decode every PDFDocEncoding byte in chunks
of at most 8,192. Decode BOM-marked UTF-16 with its declared byte order, including surrogate pairs.
Join all decoded parts before scanning. Raw stream inspection, original image decoding/OCR,
redaction, shared admission budgets and zero-forwarding failure policy remain mandatory.

This extends ADR-0016's browser adapter implementation without changing its inspection scope.
Malformed UTF-16 uses standard replacement-character handling; this is not a forensic decoder.

## Consequences

- Good: admitted long strings no longer depend on the engine's function-argument limit.
- Limit: complete decoded text still occupies memory within the existing common byte budget;
  this is bounded conversion, not omission or streaming inspection.

## Confirmation

Regression checks scan a million-character object and stream string with a synthetic sensitive
marker in the middle, verify all PDFDocEncoding mappings, escapes, both UTF-16 byte orders and
long surrogate-pair text. Keep the Linux-generated inline-image browser regression, direct
decoder assertion and captured synthetic fixture. Run verification and all browser checks.
