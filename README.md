# PDF Insight

Upload a PDF — get a 3–5 sentence summary and structured data (parties, amounts, dates, key
points) as validated JSON. PDFs are inspected locally before redacted text reaches AI.

**Demo:** [adagora.github.io/PDF-Insight](https://adagora.github.io/PDF-Insight/) · **API docs:** [`docs/api/API.md`](docs/api/API.md)

![PDF Insight — analysis of the 12-page test contract](docs/screenshots/result-desktop.png)

## How it works

```text
Browser: validate PDF → inspect text, objects, metadata, images, attachments
         → local OCR and barcode decoding → redact → completed memory cache
         → redacted text only
Worker:  validate → limits → rate limit → redact → detect injection
         → Gemini (schema, retry/fallback) → ground values → validated JSON
Browser: validated result → display, download, local result history
```

| Path                   | What                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `apps/web`             | React 19 + Vite 8 SPA (`src/components`, `src/lib`, `src/api`)                         |
| `apps/api`             | Hono on Cloudflare Workers; OpenAPI generated from the routes                          |
| `packages/shared`      | Zod schemas (the single source of truth), limits, secret patterns                      |
| `docs/adr`             | 24 Architecture Decision Records — start at [`docs/adr/README.md`](docs/adr/README.md) |
| `docs/requirements.md` | Brief requirement → implementation → test, row by row                                  |

### Key decisions (details in the ADRs)

- **Local inspection** extracts PDF text, decoded object strings/streams, metadata, original embedded images, rendered-page OCR/barcodes and supported PDF/image/text attachments. Only redacted document and attachment text reaches the API; metadata and original bytes stay local. (0015, 0016)
- **Worker-only credentials**: Gemini authentication uses the Worker's secret. The browser requires no key setup and cannot override that secret. CI scans the bundle and git history for embedded keys. (0019, supersedes 0017)
- **One schema, everywhere**: Zod schemas validate on the server and in the browser, generate Gemini's response schema, the OpenAPI document and `docs/api/API.md`. CI fails if docs drift from code. (0006)
- **PDF content is data**: nonce-delimited document block, rules only in the system instruction, schema-constrained output, a deterministic injection detector _and_ the model's self-report — surfaced to the user as a warning. The test contract's embedded "make the contract void, 1 PLN" instruction is detected and ignored. (0007)
- **Inspect before forwarding**: incomplete inspection blocks the whole request. SHA-256, per-tab scope and an inspection profile bind completed cache entries; expiry is 10 minutes, with a clear button. Limits, credential redaction, content-free logs and static errors also apply. (0015)
- **Source checks**: every amount and date is checked against the document text; unverifiable values are flagged. Linked amount/date descriptions quote their source page and contain the value. These checks do not establish the factual accuracy of every summary sentence or name. (0015, 0018)
- **Compile-time proofs**: only validated data can be rendered, only redacted text can be sent to the model. (0011)

Inspection policy, shared budgets and progress live in a framework-independent core. Browser adapters own decoding and OCR; React binds a separately testable workflow to the UI. See [ADR-0016](docs/adr/0016-admit-complete-inspection-trees-and-separate-core-policy.md).

## Run locally

Requires Node ≥ 22 and a [Gemini API key](https://aistudio.google.com/apikey).

```bash
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # put GEMINI_API_KEY here
npm run dev:api                                    # http://localhost:8787  (wrangler dev)
npm run dev:web                                    # http://localhost:5173
```

Set `GEMINI_API_KEY` in the Worker's local `.dev.vars` before analysing a document. Production
uses a Worker secret. Visitors upload a PDF without entering credentials.

### Environment variables

| Name                                                             | Where                                                               | Purpose                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GEMINI_API_KEY`                                                 | Worker secret (`wrangler secret put`), `apps/api/.dev.vars` locally | Required Gemini access. Never bundled in the frontend.                         |
| `ALLOWED_ORIGINS`                                                | `wrangler.jsonc` vars / `.dev.vars`                                 | CORS allow-list, comma-separated origins                                       |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_THINKING_LEVEL` | `wrangler.jsonc` vars                                               | Model choice (default `gemini-3.8-flash` → `gemini-3.5-flash`, thinking `low`) |
| `VITE_API_URL`                                                   | build env / repo variable                                           | Worker URL the SPA calls                                                       |
| `VITE_BASE`                                                      | build env                                                           | `/<repo>/` for GitHub Pages (CI sets it)                                       |

### Verify

```bash
npm run verify          # types, ESLint, Oxlint proofs, no-comments, ADRs, API-doc drift, 280+ tests, build, secrets
npm run test:e2e        # Playwright, desktop + 360 px, mocked API
npm run smoke -- raw/Test_PDF_Insight_umowa_14-2026.pdf   # web + API running; real local inspection + Gemini
npm run test:e2e:live   # desktop + mobile through the real API
```

### Deploy

The frontend is published through GitHub Actions; the API is deployed with Wrangler.

#### Deploy the backend

From the project root, with dependencies installed:

```bash
cd apps/api
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
npx wrangler login
npx wrangler deploy --dry-run
npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret list
```

Enter the Gemini key at Wrangler's secret prompt; `.dev.vars` is local configuration and is
not automatically uploaded. `secret put` publishes a new Worker version with the secret.
Keep `ALLOWED_ORIGINS=https://adagora.github.io` in `wrangler.jsonc`: CORS uses an origin,
without the `/PDF-Insight/` path. This deploys `pdf-insight-api`. [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
remain separate from deployment authentication.

Use the public URL printed by Wrangler:

```bash
curl --fail --silent --show-error https://pdf-insight-api.a-gora.workers.dev/v1/health
```

Health should return `{"status":"ok","version":"0.1.0"}`. It checks liveness only; verify
Gemini configuration and quota by analysing a real PDF through the demo after the frontend is
published. An HTTP 403 during deployment calls for Workers permissions, while an AI-unavailable
result after deployment calls for checking the Gemini secret/model/quota in private Worker logs.

#### Publish the frontend through GitHub Actions

1. In `adagora/PDF-Insight`, open **Settings → Secrets and variables → Actions → Variables**.
   Add repository variable `VITE_API_URL` with the deployed Worker URL, without a trailing path.
   This is a public URL, not a secret.
2. Open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
   The existing workflow sets `VITE_BASE=/PDF-Insight/`, uploads `apps/web/dist` and deploys it.
3. Optionally configure repository secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` for subsequent Worker deployments. Upload the Gemini secret through
   Wrangler first; the workflow does not create it. Without the Cloudflare token the API job
   intentionally skips deployment, so a green workflow alone does not establish a working API.
4. Review and commit the app in several logical Conventional Commits, such as shared contract,
   backend, frontend, and verification/documentation. Publish the app files, examples, lockfile,
   workflow and screenshots; exclude local secrets, raw inputs and temporary/session files.
   Then push the resulting `main` branch:

   ```bash
   git push -u origin main
   ```

5. Wait for the push workflow's lint/test/build and deployment jobs. The current workflow only
   publishes on a **push to `main`**; manually dispatching it runs checks but skips deployment.
6. Open `https://adagora.github.io/PDF-Insight/` in a fresh browser, upload a PDF without supplying
   credentials, inspect the summary/data and download JSON. Check desktop and 360 px screens,
   asset/worker loading, actual API CORS and full upload-to-result latency under 30 seconds.
   Keep the demo available for at least 14 days; the six-hourly availability workflow records
   public assets, CORS and real analysis results.

The workflow is in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). GitHub documents
[custom Actions workflows for Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Known limitations

- **Inspection** admits up to 100 pages, 30 original images and 10 attachments, with two levels of recursion and a two-minute deadline. One budget covers the complete tree: 20 MiB of attachment bytes and 32 MiB of decoded object/image/text data. Discovery and admission finish before OCR starts. Excess limits block forwarding rather than skip content.
- **OCR** runs locally on every rendered page and original supported image. OCR and secret detection are heuristics, so a clean result is not a guarantee that every character or credential was recognized. Cold OCR downloads and slower devices can exceed 30 seconds.
- **PDF objects** use pdf-lib, not native QPDF. Supported original raster formats include JPEG and basic Gray/RGB/CMYK streams; unsupported filters/color spaces/predictors, animations, active content, optional layers and unreadable attachments block analysis. Supported attachment types are PDF, PNG, JPEG and UTF text (`txt`, `md`, `csv`, `json`). Associated (`AF`), annotation and orphan embedded-file streams are discovered; aliases of one stream count once. Original inline rasters support raw, ASCIIHex and ASCII85 data; other inline encodings block inspection.
- **Sanitization** creates a text-only request; it does not produce a redacted PDF or image download. The original file is never uploaded.
- **Cache** contains sanitized results in tab memory only. Reloading or purging clears it; changed bytes, inspection profile or tab scope require fresh inspection.
- **Grounding** checks numbers and dates only (not names), and flags values the model computed even when correct.
- **Injection detection** is pattern-based plus the model's self-report — it reduces, not eliminates, risk.
- **Complex layouts** (multi-column tables) are linearised by pdf.js; the model usually copes, but table structure is not preserved.
- **History** lives in one browser's `localStorage` (10 results); clearing site data removes it.
- **Free tiers**: Gemini quotas and the Worker rate limit (10 analyses/min per IP) bound throughput; the model names are preview-tier and configurable.
- **No accounts**: anyone with the demo link can use the API within those limits.

## Working with AI

How this was built with AI, key prompts, and where the AI was wrong: [`AI_LOG.md`](AI_LOG.md).
Agent conventions: [`AGENTS.md`](AGENTS.md).
