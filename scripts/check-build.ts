import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = "apps/web/dist";
const base = process.env.VITE_BASE ?? "/";
const apiUrl = process.env.VITE_API_URL ?? "http://localhost:8787";
const problems: string[] = [];

if (!existsSync(join(DIST, "index.html"))) {
  process.stderr.write(`${DIST}/index.html missing — run the web build first.\n`);
  process.exit(1);
}

const html = readFileSync(join(DIST, "index.html"), "utf8");
const assets = readdirSync(join(DIST, "assets"));

const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
if (csp === undefined) problems.push("index.html has no Content-Security-Policy meta tag");
else {
  if (!csp.includes(`connect-src 'self' ${new URL(apiUrl).origin}`))
    problems.push(`CSP connect-src does not allow ${apiUrl}`);
  if (/(?:^|\s)'unsafe-eval'(?:\s|;|$)/.test(csp)) problems.push("CSP must not allow unsafe-eval");
  if (/script-src[^;]*unsafe-inline/.test(csp)) problems.push("CSP must not allow inline scripts");
}

for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (url !== undefined && !/^https?:/.test(url) && !url.startsWith(base)) {
    problems.push(`asset URL ${url} does not start with base ${base} (GitHub Pages pitfall)`);
  }
}

const worker = assets.filter((name) => name.startsWith("pdf.worker"));
if (worker.length === 0) problems.push("pdf.js worker asset missing");
if (assets.some((name) => name.endsWith(".mjs")))
  problems.push(".mjs assets found — GitHub Pages may serve them with a non-JS MIME type");
if (assets.some((name) => name.endsWith(".map"))) problems.push("source maps must not be published");
const bundle = assets
  .filter((name) => name.endsWith(".js"))
  .map((name) => readFileSync(join(DIST, "assets", name), "utf8"));
if (!bundle.some((code) => code.includes(`${base}assets/pdf.worker`) || code.includes("pdf.worker"))) {
  problems.push("bundle never references the pdf.js worker");
}
if (bundle.some((code) => code.includes("GEMINI_API_KEY"))) problems.push("bundle mentions GEMINI_API_KEY");

if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Build OK for base ${base} and API ${apiUrl} (${assets.length} assets).\n`);
