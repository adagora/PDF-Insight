# 0004. Cloudflare Workers + Hono as the API proxy

- **Status:** Superseded by [0017](0017-session-scoped-personal-gemini-keys.md)
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

GitHub Pages serves static files only; the Gemini key must live server-side (§03, disqualification
criterion). The demo must work ≥ 14 days on free tiers and answer in < 30 s.

## Considered options

1. Cloudflare Workers — free tier, secrets store, built-in rate-limiting binding, no cold starts,
   global edge.
2. Vercel / Netlify functions — fine, but cold starts and 10 s default timeouts on free plans.
3. Supabase Edge Functions — Deno; adds a platform we do not otherwise need.
4. Own Node server — needs hosting that stays up for 14 days.

## Decision

We will deploy `apps/api` to **Cloudflare Workers** using **Hono** with `@hono/zod-openapi`
(routes are declared with Zod schemas, which also yields the OpenAPI document — ADR-0006).

- The Gemini key is a Worker secret (`wrangler secret put GEMINI_API_KEY`); locally it is read from
  `apps/api/.dev.vars`, which is git-ignored.
- Runtime config (`ALLOWED_ORIGINS`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`) lives in
  `wrangler.jsonc` `vars`.
- Hono is runtime-agnostic, so tests call `app.request()` in Vitest without Wrangler.

## Consequences

- Good: zero cost, key never reaches the browser, fast edge responses, same code testable in Node.
- Bad: free-plan CPU limit (10 ms) forbids heavy work in the Worker — we keep PDF parsing in the
  browser (ADR-0003) and keep server work to JSON parsing, regex scans and fetch.

## Confirmation

- `npm run check:secrets` scans tracked files and `apps/web/dist` for API-key patterns; CI fails on
  any hit.
- `.gitignore` covers `.env*` and `.dev.vars*`; the pre-commit hook runs the same scan.
