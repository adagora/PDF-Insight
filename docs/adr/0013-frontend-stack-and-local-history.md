# 0013. Frontend: React 19 + Vite 8, single view, plain CSS, history in localStorage

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

Required: React 18+ with Vite, TypeScript strict, GitHub Pages, responsive from 360 px, keyboard
accessible, Polish messages (§03, §05). F-09 (SHOULD): recent results stored locally.
GitHub Pages pitfalls: `base: '/<repo>/'`, routing, `VITE_API_URL`, pdf.js worker path.

## Considered options

- Routing: React Router with `HashRouter` vs **no router** (one screen whose state machine is
  `empty → extracting → analyzing → result | error`).
- Styling: Tailwind / component library vs **plain CSS with custom properties**.
- History: IndexedDB vs **localStorage** (results are small JSON; no binary).

## Decision

- **No router.** The app is one view driven by a reducer state machine; history entries open in
  the same view. No deep links → no `404.html`/`HashRouter` problem on Pages.
- **Plain CSS** (`src/styles.css`) with design tokens as CSS custom properties, light/dark via
  `prefers-color-scheme`, system font stack (no third-party font requests, CSP stays `'self'`).
- **History**: last 10 `ValidatedAnalysis` results under key `pdf-insight:history:v1`. Entries are
  re-validated with Zod on read (stored data is untrusted input too); invalid entries are dropped.
  Document text is **not** stored, only the result JSON. The user can delete entries or clear all.
- `base` comes from `VITE_BASE` (default `/`; CI sets `/<repo>/`). API URL from `VITE_API_URL`.
- CSP via `<meta http-equiv>` built at compile time to allow `connect-src` to the API origin only.

## Consequences

- Good: tiny bundle, no routing pitfalls, history survives reloads without a backend.
- Bad: history is per-browser and lost when site data is cleared (stated in the UI).

## Confirmation

- `apps/web/test/history.test.ts` — round-trip, cap at 10, corrupted entries dropped.
- `npm run build -w apps/web` with `VITE_BASE=/pdf-insight/` produces correct asset and worker URLs
  (checked in CI by `scripts/check-build.ts`).
