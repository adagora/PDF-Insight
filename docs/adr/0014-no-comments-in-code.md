# 0014. Code carries no comments; rationale lives in ADRs, commits and names

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

The project owner asked that agents not add comments to code. Comments written by agents drift
from the code they describe, restate what names already say, and scatter rationale that this
project already records in ADRs (0001) and Conventional Commit messages. One tool needs a
comment: the owner's `aw-type-evidence` Oxlint plugin requires a `// SAFETY:` justification on
every type assertion (ADR-0011).

## Considered options

1. Allow comments, rely on review — agents add them by default; drift is invisible.
2. Ban all comments — conflicts with tool directives (`SAFETY:`, lint suppressions).
3. **No comments, except tool-mandated single-line directives, enforced by a script.**

## Decision

Source files (`*.ts`, `*.tsx`, `*.js`) contain no comments. Explanations go to:

- **names** — what a thing is;
- **ADRs** — why a design is the way it is;
- **commit messages** — what changed and why now.

Allowed, each on a single line: `// SAFETY: <checked invariant>`,
`// eslint-disable-next-line <rule> -- <reason>`, `// oxlint-disable-next-line <rule> -- <reason>`,
`// prettier-ignore`, `// @ts-expect-error — <reason>`. Prefer code that needs none of them
(e.g. a type guard instead of an `as` cast).

## Consequences

- Good: no stale comments; rationale is findable in one place; diffs stay about behaviour.
- Bad: subtle algorithms (grounding, chunking) are explained only in their ADR and tests. Accepted:
  the tests are executable documentation and the ADR index points to the right file.

## Confirmation

- `npm run check:comments` (CI, pre-commit) parses every source file with the TypeScript compiler
  and fails on any comment outside the allowed directives. `--fix` strips them.
