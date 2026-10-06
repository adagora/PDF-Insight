# 0019. Keep Gemini credentials only in the Worker

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** project owner, Codex

## Context

The requirements audit against the project specification found that frontend key entry
conflicts with §03 and §05: the AI key must remain in backend secrets, and a stranger must
be able to use the demo without providing credentials. The owner requested removing the
frontend key option to meet that requirement. This record supersedes ADR-0017; the Worker
proxy and deployment architecture from ADR-0004 remain in effect.

## Considered options

1. Hide key settings while retaining the credential header — still permits browser credentials.
2. Remove browser key entry and its request contract; authenticate only with the Worker secret.

## Decision

We will use option 2.

- Remove the key dialog, settings controls, page-memory key state and key-specific messages.
- Remove the personal-key header from the shared and generated HTTP contract and CORS allow-list.
- The Worker uses only its configured `GEMINI_API_KEY`; request headers cannot override it.
- A missing or rejected Worker key returns the fixed `AI_UNAVAILABLE` error. Provider responses
  and credentials never reach clients or logs. Users retain the ordinary retry action.
- Production credentials belong in Worker secrets; local development uses git-ignored
  `apps/api/.dev.vars`. The frontend bundle, history and exports contain no credential.

## Consequences

- Good: the application meets the brief's credential rule and needs no key setup from users.
- Accepted trade-off: the demo owner provides Gemini quota and keeps the Worker secret configured.
- Historical ADRs and AI log entries remain as records of the superseded implementation.

## Confirmation

- API security tests prove a request header cannot override the Worker secret or compensate for
  a missing secret, provider authentication errors remain private, and CORS omits the header.
- Browser/client checks cover credential-free upload, results, export and retry.
- `npm run docs:api`, review the generated contract changes, `npm run verify`,
  `npm run test:e2e`, supplied-PDF smoke and live desktop/mobile e2e.
