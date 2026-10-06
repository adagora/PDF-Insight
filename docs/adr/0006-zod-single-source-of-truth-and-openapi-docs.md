# 0006. Zod is the single source of truth; OpenAPI docs are generated and drift-checked

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

The same contract appears in four places: runtime validation (backend + frontend), the JSON schema
sent to Gemini, the HTTP API surface, and human/agent-readable docs. Hand-maintained copies drift.
Agents in particular need a way to **compare what they intended** (the reviewed contract) **with
what the code actually produces**.

## Considered options

1. Hand-written `openapi.yaml` + separate Zod schemas — two sources, guaranteed drift.
2. Generate Zod from OpenAPI — the AI schema and refinements are awkward to express in YAML.
3. **Zod first**: routes declared with `@hono/zod-openapi`; Gemini schema via `z.toJSONSchema()`;
   OpenAPI 3.1 document and Markdown docs generated from the running app definition.

## Decision

We will treat the Zod schemas in `packages/shared` (public contract) and `apps/api/src/lib/llm-schema.ts`
(AI contract) as the only source of truth.

- `npm run docs:api` regenerates `docs/api/openapi.json` and `docs/api/API.md` from the Hono app.
- `npm run docs:api:check` regenerates into memory and **fails if the committed files differ**.
  Committed docs are the _intended_ contract; a diff means the code changed the contract — the
  author must either regenerate deliberately (and review the diff) or fix the code.
- Contract tests validate real responses of `app.request()` against the response schemas in the
  generated document.
- `GET /openapi.json` serves the same document at runtime.

## Consequences

- Good: one edit propagates everywhere; agents get a readable `API.md` to diff against intent;
  CI catches accidental contract changes.
- Bad: the OpenAPI doc can only express what Zod-to-OpenAPI supports (refinements are documented
  as descriptions). Accepted.

## Confirmation

- CI step `npm run docs:api:check`.
- `apps/api/test/contract.test.ts`.
