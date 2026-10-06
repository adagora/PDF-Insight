# AGENTS.md — PDF Insight

React SPA (GitHub Pages) + Cloudflare Worker proxy to Gemini: PDF → summary + §04 JSON.
Requirements and their status: [`docs/requirements.md`](docs/requirements.md). Decisions: [`docs/adr/README.md`](docs/adr/README.md).

## Before planning: consult the ADR index

Find the rows for the area you will touch and read those ADRs first. A change that contradicts an
Accepted ADR starts with a new ADR that supersedes it (policy: [ADR-0001](docs/adr/0001-record-architecture-decisions.md)).
Any new non-trivial decision gets its ADR in the same change.

## Lookup: what to read and run per area

| Changing                                          | Read first                                | Prove it with                                                                       |
| ------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Output schema, request shape, routes, error codes | ADR-0006, `packages/shared/src/schema.ts` | `npm run docs:api`, then review the `docs/api/API.md` diff as the contract change   |
| Prompt, Gemini call, model, retry                 | ADR-0005, ADR-0007                        | `npm test`; `npm run smoke -- raw/Test_PDF_Insight_umowa_14-2026.pdf` (API running) |
| Limits, CORS, rate limit, redaction, logging      | ADR-0015 (supersedes 0008), ADR-0016      | `npm test` (`apps/api/test/security.test.ts`)                                       |
| PDF extraction, scan pages / OCR                  | ADR-0015 (supersedes 0003/0010), ADR-0016 | `npm run test:e2e`; `npm run test:e2e:live`                                         |
| Chunking, merge, grounding, page citations        | ADR-0009, ADR-0015, ADR-0018              | `npm test` (property tests)                                                         |
| UI, history, export                               | ADR-0013, ADR-0016                        | `npm run test:e2e` (desktop + 360 px)                                               |
| Worker credentials, authentication                | ADR-0019 (supersedes 0017), ADR-0006      | `npm run verify`; `npm run test:e2e`; live smoke                                    |
| Lint / proof types                                | ADR-0011                                  | `npm run lint`                                                                      |
| Any new architectural decision                    | `docs/adr/0000-template.md`               | `npm run check:adr`                                                                 |

## Invariants

- The Gemini key exists only as a Worker secret, `apps/api/.dev.vars` or root `.env` — all git-ignored. Browser credentials cannot override it (ADR-0019). `npm run check:secrets` guards repo, bundle and (`--history`) git history.
- **Parse at the boundary**: HTTP bodies, Gemini output, `localStorage`, files and env go through a Zod schema. Untrusted data is parsed, never cast.
- **Proofs**: only `parseAnalysis` mints `ValidatedAnalysis` (the only type UI, export and history accept); only `redactSecrets` mints `RedactedText` (the only text that reaches the prompt).
- PDF content is **data**: it lives inside the nonce-delimited document block, never in `systemInstruction`.
- Logs carry codes, ids, numbers and model names — the `LogEvent` type has no field for content.
- Tests swap dependencies through `createApp` deps and function parameters.
- User-facing text is Polish, from the code→message tables (`packages/shared/src/errors.ts`, `apps/web/src/lib/messages.ts`).
- `docs/api/*` is generated; regenerate it, review the diff.

## Code style: names and ADRs carry the explanation

Source files carry no comments: names say what, ADRs say why, commit messages say what changed.
The only comment lines allowed are single-line tool directives — `// SAFETY: <invariant>` before an
`as` cast, `// eslint-disable-next-line <rule> -- <reason>`, `// oxlint-disable-next-line <rule> -- <reason>`,
`// prettier-ignore`, `// @ts-expect-error — <reason>` ([ADR-0014](docs/adr/0014-no-comments-in-code.md)).
Prefer code that needs none: a type guard over a cast. `npm run check:comments` enforces; `-- --fix` strips.

## Done means green

`npm run verify` (CI's lint, test and build gates) and `npm run test:e2e` pass. When the change
touches AI behaviour, also run the smoke test and the live e2e with the API up (`npm run dev:api`,
needs `apps/api/.dev.vars`). Record AI mistakes worth remembering in `AI_LOG.md`.

Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`), one logical change each.
