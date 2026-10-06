# 0007. Treat PDF content as data: prompt-injection defense in depth

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

§05 "Treść PDF to dane, nie instrukcje". The supplied test contract contains an embedded
instruction aimed at AI systems (page 4) asking the model to declare the contract void and its
value 1 PLN. No single control stops injection reliably; we layer cheap ones and make the
outcome visible to the user.

## Considered options

1. Prompt wording only — necessary, not sufficient.
2. Strip suspicious sentences before sending — destroys evidence, false positives remove real
   contract text.
3. **Layered**: trusted rules in `systemInstruction`; document in a nonce-delimited block
   ("spotlighting"); rules repeated after the block; schema-constrained output; the model reports
   `injectionDetected`; an independent deterministic detector; grounding checks (ADR-0012);
   a user-visible warning.

## Decision

We will implement option 3:

1. **System instruction** holds all rules; the user turn contains only the document wrapped in
   `<document id="{random nonce}">…</document id="{nonce}">`, with the rules restated after it.
   The nonce is generated per request so the document cannot forge the closing tag.
2. **Structured output** (ADR-0005) — the model can only fill fields; it cannot "reply" freely.
3. **Model self-report** — `injectionDetected: boolean` + `injectionExcerpt` in the AI schema.
4. **Deterministic detector** (`apps/api/src/lib/injection.ts`) — PL/EN/DE patterns such as
   "zignoruj … polecenia", "ignore previous instructions", "system prompt". Runs on every page;
   independent of the model.
5. Either signal adds warning `PROMPT_INJECTION_SUSPECTED` (with page number) to the result; the UI
   shows it. Nothing is silently removed from the document.

## Consequences

- Good: the attack in the test PDF is detected twice and surfaced, not just ignored.
- Bad: the deterministic detector can false-positive on documents _about_ prompt injection. It
  only adds a warning, so the cost is low.

## Confirmation

- `apps/api/test/injection.test.ts` — detector patterns (incl. the test PDF sentence).
- `apps/api/test/prompt.test.ts` — nonce delimiting; document text never appears in
  `systemInstruction`.
- `npm run smoke` asserts the summary does not claim the contract is void / worth 1 PLN and that the
  warning is present.
