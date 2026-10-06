# 0017. Allow session-scoped personal Gemini keys through the Worker

- **Status:** Superseded by [0019](0019-keep-gemini-credentials-only-in-the-worker.md)
- **Date:** 2026-10-05
- **Deciders:** project owner, Codex

## Context

The owner requested entering a Gemini API key from the frontend, with Stripe-inspired form
conventions. ADR-0004 requires all keys to remain server-side. The new option must work when
the Worker has no application key and must preserve local inspection and content-free logging.

This record supersedes ADR-0004. Its Cloudflare Worker, Hono and deployment decisions remain.
The original brief's prohibition on personal keys in the browser is intentionally revised by
the owner's request; the application's own key remains a Worker secret.

## Considered options

1. Persist personal keys in localStorage — convenient across reloads, but retains credentials.
2. Call Gemini directly from the browser — bypasses proxy limits, redaction and validation.
3. Keep personal keys in page memory and send them to the existing Worker per request.

## Decision

We will use option 3.

- The optional personal key is held only in React-owned page memory. Reloading, closing the
  page or removing the key clears it. No storage, history, result or export contains it.
- A native modal has a labeled, masked input, reveal control, inline validation, cancel,
  replace and remove actions. Copy distinguishes a key being added from provider validation;
  Gemini verifies access during analysis. Polish text lives in the message tables.
- A shared Zod schema validates keys as bounded ASCII tokens without assuming a provider prefix.
- `x-gemini-api-key` is an optional, documented request header. A personal key takes precedence
  for that request alone; omission uses the Worker secret. CORS explicitly allows the header.
- The Worker forwards the selected key only in Gemini's authentication header. Keys are never
  put in URLs, prompts, document bodies, validation issues, errors or logs.
- Invalid personal credentials yield a fixed `API_KEY_INVALID` error without fallback to the
  application key. Missing both keys yields `API_KEY_REQUIRED`. Provider payload errors retain
  `AI_UNAVAILABLE`; only explicit invalid-key details or HTTP 401/403 indicate credential rejection.
- The frontend exposes key settings from all workflow states. Settings are disabled during
  inspection and analysis. Updating a key after an error preserves the inspected retry request.

## Consequences

- Good: users can supply their own quota without a configured application key.
- Good: refresh clears credentials and all analysis still follows the existing proxy pipeline.
- Accepted trade-off: a user-supplied secret is accessible to page scripts while the page is open
  and is disclosed to the configured Worker and Google for authentication. The UI states this.
- Accepted trade-off: users re-enter keys after refresh; adding a key does not preflight Gemini.

## Confirmation

- API security tests cover personal-key precedence, cross-request isolation, absent keys,
  CORS, invalid headers, upstream rejection and absence from bodies, URLs, results and logs.
- Desktop and 360 px browser tests cover masked entry, reveal, errors, cancel, removal,
  keyboard focus, refresh clearing, request transport and retry with a replacement key.
- `npm run verify`, `npm run test:e2e`, supplied-PDF smoke and live e2e.
