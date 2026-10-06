# 0001. Record architecture decisions as MADR files

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude (coding agent)

## Context

This project is built mostly by coding agents across many sessions. Agents start each session
cold: without a durable record, they re-litigate settled questions, silently reverse earlier
choices, or "fix" deliberate trade-offs. Humans reviewing the repo (recruiters, maintainers) also
need to see _why_ the code looks the way it does.

## Considered options

1. No records; rely on commit messages — decisions get lost in history, agents never read it.
2. One big `ARCHITECTURE.md` — grows stale, no status/supersession, merge conflicts.
3. One MADR file per decision in `docs/adr/`, indexed from `AGENTS.md` — small, append-only,
   greppable.

## Decision

We will record every non-trivial architectural decision as a MADR record in
`docs/adr/NNNN-title.md` with the sections **Status / Context / Considered options / Decision /
Consequences / Confirmation** (template: [0000-template.md](0000-template.md)).

Policy:

- **Non-trivial** = hard to reverse, affects more than one module, touches security, the public
  API / output schema, the AI prompt contract, or a dependency choice.
- **Never delete an ADR.** To change a decision: write a new ADR, then set the old one's status to
  `Superseded by [NNNN](NNNN-title.md)`. Both files stay.
- Every ADR names its **Confirmation** — the test, lint rule or CI step that keeps it true.
- The ADR index in [`README.md`](README.md) and the lookup table in `/AGENTS.md` are updated in the
  same change that adds an ADR.
- Agents consult the index **before** planning work that touches an area an ADR covers, and write
  the ADR **before** (or together with) the code that implements a new decision.

## Consequences

- Good: decisions survive across agent sessions; reviewers can audit reasoning; supersession
  keeps history honest.
- Bad: a little ceremony per decision. Accepted — the cost of a wrong silent reversal is higher.

## Confirmation

- `npm run check:adr` validates that every `docs/adr/NNNN-*.md` has the required sections and a
  valid status, that numbers are unique, and that each ADR is listed in `docs/adr/README.md`.
- Code review / agents: `AGENTS.md` tells agents to read the ADR index first.
