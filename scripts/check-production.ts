import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { HealthSchema, parseAnalysis } from "@pdf-insight/shared";
import { z } from "zod";

const { values } = parseArgs({
  options: {
    web: { type: "string", default: "https://adagora.github.io/PDF-Insight/" },
    api: { type: "string", default: "https://pdf-insight-api.a-gora.workers.dev" },
    out: { type: "string" },
  },
});
const options = z.object({ web: z.url(), api: z.url(), out: z.string().optional() }).parse(values);
const started = performance.now();
const web = await fetch(options.web, { signal: AbortSignal.timeout(15000) });
const html = await web.text();
const asset = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
const assetResponse =
  asset === undefined ? null : await fetch(new URL(asset, options.web), { signal: AbortSignal.timeout(15000) });
const health = await fetch(`${options.api}/v1/health`, { signal: AbortSignal.timeout(15000) });
const healthy = HealthSchema.safeParse(await health.json());
const origin = new URL(options.web).origin;
const preflight = await fetch(`${options.api}/v1/analyze`, {
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
  },
  signal: AbortSignal.timeout(15000),
});
const response = await fetch(`${options.api}/v1/analyze`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({
    fileName: "monitor.pdf",
    pageCount: 1,
    pages: [
      {
        number: 1,
        text: "NOTATKA O KOPIACH ZAPASOWYCH\nKopie zapasowe należy wykonywać codziennie. Kopie należy przechowywać na oddzielnym nośniku. Raz w miesiącu należy sprawdzać możliwość odtworzenia danych.",
      },
    ],
  }),
  signal: AbortSignal.timeout(35000),
});
const parsed = parseAnalysis(await response.json());
const checks = {
  web: web.ok,
  script: assetResponse?.ok === true,
  health: health.ok && healthy.success,
  preflightCors: preflight.ok && preflight.headers.get("access-control-allow-origin") === origin,
  analysisCors: response.headers.get("access-control-allow-origin") === origin,
  analysis: response.ok && parsed.ok,
  missingFacts:
    parsed.ok &&
    parsed.value.document.date === null &&
    parsed.value.amounts.length === 0 &&
    parsed.value.dates.length === 0 &&
    parsed.value.entities.people.length === 0 &&
    parsed.value.entities.organizations.length === 0,
};
const evidence = {
  observedAt: new Date().toISOString(),
  web: options.web,
  api: options.api,
  ms: performance.now() - started,
  checks,
  requestId: response.headers.get("x-request-id"),
  passed: Object.values(checks).every(Boolean),
};
if (options.out !== undefined) {
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(evidence, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
process.exitCode = evidence.passed ? 0 : 1;
