# 0002. Monorepo with npm workspaces and a shared schema package

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

The brief requires a React SPA on GitHub Pages plus a backend proxy holding the API key (F-07,
§03). The output JSON schema (§04) must be validated **twice**: on the backend (to retry a bad AI
answer once) and on the frontend (F-04 "walidowany przed wyświetleniem"). Two copies of one
schema drift.

## Considered options

1. Two repos (web, api) — schema duplicated or published as a package; slow iteration.
2. Single package, backend in `api/` folder of the web app — tangled tsconfigs (DOM vs Workers
   types), one lint config for two runtimes.
3. npm workspaces: `apps/web`, `apps/api`, `packages/shared` — one install, one CI, schema
   imported as source by both apps.

## Decision

We will use npm workspaces:

| Path              | Runtime            | Role                                                                            |
| ----------------- | ------------------ | ------------------------------------------------------------------------------- |
| `packages/shared` | any (pure TS)      | Zod schemas, limits, ISO code lists, secret patterns. No runtime-specific APIs. |
| `apps/api`        | Cloudflare Workers | Hono API proxy to Gemini.                                                       |
| `apps/web`        | Browser            | React SPA (structure `components/ lib/ api/` per brief §05).                    |

`packages/shared` ships TypeScript source (`exports` → `src/index.ts`); Vite, Wrangler (esbuild)
and Vitest compile it directly — no build step.

## Consequences

- Good: one schema, one `npm ci`, one CI pipeline; type errors across the boundary surface
  immediately.
- Bad: `packages/shared` must stay runtime-neutral (no DOM, no Workers globals). Accepted and
  enforced by its tsconfig (`lib: ["ES2023"]`, no `dom`, no workers types).

## Confirmation

- `npm run typecheck` type-checks each workspace with its own `lib` settings; DOM or Workers usage
  in `packages/shared` fails compilation.
