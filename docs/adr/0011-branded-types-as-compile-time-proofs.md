# 0011. Branded types as compile-time proofs of validation and redaction

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

Two invariants are easy to break by accident and hard to spot in review:

1. F-04: the UI must only ever render/export data that passed schema validation.
2. ADR-0008: only **redacted** text may be sent to the AI provider.

Trusted parsers mint branded values, sensitive functions require them, and lint prevents
unchecked assertions from bypassing validation. The local `tools/oxlint/aw-type-evidence`
plugin also guards I/O boundaries, narrowing and documented assertions.

## Considered options

1. Runtime checks only — correct today, silently bypassable tomorrow.
2. Use a general authorization-proof library — broader than these validation invariants.
3. **Zod `.brand()` types as proofs + the supplied Oxlint plugin as the anti-forgery lint.**

## Decision

We will use option 3:

- `ValidatedAnalysis` = `AnalysisResultSchema.brand<"ValidatedAnalysis">()` output. It can only be
  minted by `parseAnalysis()` in `packages/shared`. `ResultView`, `exportJson()` and the history
  store accept only `ValidatedAnalysis`.
- `RedactedText` is minted only by `redactSecrets()`; `buildPrompt()` accepts only `RedactedText`.
- `npm run lint:types` runs Oxlint with `tools/oxlint/aw-type-evidence` (`jsPlugins`) and **all 15
  of its rules** over `apps`, `packages`, `scripts` and `e2e` — tests included, so tests parse
  responses with Zod instead of casting them, and replace dependencies through `createApp` deps
  instead of module mocking (`no-module-mocking`). Forging a brand requires an `as` cast, which then
  requires a single-line `// SAFETY:` justification visible in review (ADR-0014).
- Genuine I/O-boundary parsers (`parseAnalysis`, `parseLlmExtraction`, `parseLlmSynthesis`, the
  Gemini `parse` callback) take `unknown` with a documented
  `oxlint-disable-next-line aw-type-evidence/no-unknown-parameters` — the rule's own message names
  the I/O boundary as the place `unknown` belongs.

## Consequences

- Good: "display unvalidated data" and "send unredacted text" become type errors.
- Bad: Oxlint JS plugins are newer tooling than ESLint; if they break, ESLint + `tsc` still guard
  the core rules. We keep ESLint + Prettier as the brief requires; Oxlint is an additional gate.

## Confirmation

- `npm run typecheck` (brands), `npm run lint:types` (forgery), both in CI.
- `packages/shared/test/schema.test.ts` exercises `parseAnalysis()` as the only mint.
