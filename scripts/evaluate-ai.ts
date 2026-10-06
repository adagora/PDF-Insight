import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs, parseEnv } from "node:util";

import { AnalyzeRequestSchema, ApiErrorSchema, parseAnalysis } from "@pdf-insight/shared";
import { z } from "zod";

import { createApp } from "../apps/api/src/app";
import { memoryLimiter } from "../apps/api/src/lib/rate-limit";

const { values } = parseArgs({
  options: {
    cases: { type: "string", default: "docs/evaluation/cases.json" },
    out: { type: "string" },
    model: { type: "string", default: "gemini-3.8-flash" },
  },
});
const options = z
  .object({ cases: z.string().min(1), out: z.string().min(1), model: z.string().regex(/^[a-z0-9.-]+$/) })
  .parse(values);
const Case = z.object({
  name: z.string(),
  request: AnalyzeRequestSchema,
  expected: z.object({
    language: z.string(),
    type: z.string(),
    date: z.string().nullable(),
    amounts: z.array(z.object({ value: z.number(), currency: z.string() })),
    dates: z.array(z.string()),
    organizations: z.array(z.string()),
    people: z.array(z.string()),
    summaryTerms: z.array(z.string()),
  }),
});
const cases = z.array(Case).parse(JSON.parse(readFileSync(options.cases, "utf8")));
const credentials = z
  .object({ GEMINI_API_KEY: z.string().min(10) })
  .parse(parseEnv(readFileSync("apps/api/.dev.vars", "utf8")));
const app = createApp({
  fetch,
  now: Date.now,
  uuid: randomUUID,
  logger: { log: () => undefined },
  fallbackLimiter: memoryLimiter(1_000, 60_000, Date.now),
});
const evidence = [];
for (const entry of cases) {
  const start = performance.now();
  const response = await app.request(
    "/v1/analyze",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry.request) },
    { ...credentials, GEMINI_MODEL: options.model, GEMINI_FALLBACK_MODEL: "" },
  );
  const body: unknown = await response.json();
  const parsed = parseAnalysis(body);
  const error = ApiErrorSchema.safeParse(body);
  const checks = {
    http200: response.status === 200,
    schema: parsed.ok,
    language: false,
    type: false,
    mainDate: false,
    amounts: false,
    dates: false,
    organizations: false,
    people: false,
    summaryFacts: false,
  };
  if (parsed.ok) {
    const result = parsed.value;
    checks.language = result.document.language === entry.expected.language;
    checks.type = result.document.type === entry.expected.type;
    checks.mainDate = result.document.date === entry.expected.date;
    checks.amounts =
      entry.expected.amounts.every((expected) =>
        result.amounts.some((actual) => actual.value === expected.value && actual.currency === expected.currency),
      ) &&
      result.amounts.every((actual) =>
        entry.expected.amounts.some(
          (expected) => actual.value === expected.value && actual.currency === expected.currency,
        ),
      );
    checks.dates =
      entry.expected.dates.every((date) => result.dates.some((actual) => actual.date === date)) &&
      result.dates.every((actual) => entry.expected.dates.includes(actual.date));
    checks.organizations =
      entry.expected.organizations.every((name) => result.entities.organizations.includes(name)) &&
      result.entities.organizations.every((name) => entry.expected.organizations.includes(name));
    checks.people =
      entry.expected.people.every((name) => result.entities.people.includes(name)) &&
      result.entities.people.every((name) => entry.expected.people.includes(name));
    checks.summaryFacts = entry.expected.summaryTerms.every((term) =>
      result.summary
        .toLocaleLowerCase(entry.expected.language)
        .includes(term.toLocaleLowerCase(entry.expected.language)),
    );
  }
  const sample = {
    name: entry.name,
    model: options.model,
    status: response.status,
    errorCode: error.success ? error.data.error.code : null,
    sourceChars: entry.request.pages.reduce((total, page) => total + page.text.length, 0),
    observedOrganizations: parsed.ok ? parsed.value.entities.organizations : null,
    observedPeople: parsed.ok ? parsed.value.entities.people : null,
    ms: performance.now() - start,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
  evidence.push(sample);
  process.stdout.write(`${JSON.stringify(sample)}\n`);
}
mkdirSync(dirname(options.out), { recursive: true });
writeFileSync(options.out, `${JSON.stringify(evidence, null, 2)}\n`);
process.exitCode = evidence.every((sample) => sample.passed) ? 0 : 1;
