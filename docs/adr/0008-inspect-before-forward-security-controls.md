# 0008. Inspect before forwarding: limits, secret redaction, logging discipline

- **Status:** Superseded by [0015](0015-local-attachment-inspection-before-ai.md)
- **Date:** 2026-10-05
- **Deciders:** project owner, Claude

## Context

§05 security: key never in the frontend or Git history, CORS limited to the demo domain, request
and size limits, user informed that the file goes to an AI API. The Worker validates and
redacts the complete request before it reaches the model.

## Considered options

1. Minimal: CORS + key in secrets.
2. **Inspection proxy**: the whole request is inspected and validated before anything is
   forwarded; secrets are redacted; logs never contain content; errors are static codes.
3. A separate native attachment-inspection service — out of proportion for an MVP.

## Decision

We will implement option 2:

| Control                                         | Our implementation                                                                                                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect the whole request before forwarding     | Zod-validate body, then size / page / char limits, then redaction, then Gemini. No partial forwarding.                                                                                                                                             |
| `redact` mode with `[REDACTED:kind]` tokens     | `packages/shared/src/secrets.ts` patterns (AWS, GitHub, Google/Gemini, OpenAI, Anthropic, Slack, Stripe, JWT, private keys, URL credentials). Redacted text is what reaches Gemini; counts go to `meta.redactions` and warning `SECRETS_REDACTED`. |
| Never log prompts, secrets, filenames, OCR text | Logger accepts only `{ code, requestId, status, ms }`. No document text, file names or AI output in logs.                                                                                                                                          |
| Static error codes + opaque IDs                 | Error body `{ error: { code, message, requestId } }`; `message` is a fixed Polish string per code. Upstream error bodies are never echoed.                                                                                                         |
| Bounded limits                                  | `bodyLimit` 8 MB, ≤ 500 pages, ≤ 480 000 chars, ≤ 5 OCR images × ≤ 1.5 MB, 28 s deadline.                                                                                                                                                          |
| Request correlation                             | `X-Request-Id` (UUID) on every response.                                                                                                                                                                                                           |
| Same detector everywhere                        | The secret patterns also power `npm run check:secrets` (repo + build output) and the pre-commit hook.                                                                                                                                              |

Plus standard controls: CORS allow-list from `ALLOWED_ORIGINS` **and** a 403 for disallowed
`Origin` headers (CORS alone does not stop the request); per-IP rate limit via the Workers
Rate Limiting binding (in-memory fallback in dev/tests); `secureHeaders`; `Cache-Control: no-store`.
Frontend: CSP meta tag, no `dangerouslySetInnerHTML` (lint rule), visible notice that content is
sent to Google Gemini.

## Consequences

- Good: accidental credentials in uploaded documents never reach the AI provider; logs are safe to
  share; CI blocks the disqualifying mistake (key in bundle or repo).
- Bad: regex detection has false negatives (novel key formats) and rare false positives
  (redacting a harmless token). Accepted for an MVP; the patterns are one file to extend.

## Confirmation

- `packages/shared/test/secrets.test.ts`, `apps/api/test/security.test.ts` (CORS 403, 413, 415,
  429, no content in logs, static messages).
- CI: `npm run check:secrets` after the web build.
- ESLint: `no-restricted-syntax` bans `dangerouslySetInnerHTML`; `no-console` everywhere except the
  logger module.
