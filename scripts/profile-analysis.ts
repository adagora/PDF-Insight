import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs, parseEnv } from "node:util";

import { AnalyzeRequestSchema, parseAnalysis, redactSecrets } from "@pdf-insight/shared";
import { z } from "zod";

import { createApp } from "../apps/api/src/app";
import { normalizeText } from "../apps/api/src/lib/analyze";
import { parseCitedAmounts, parseCitedDates, parseCitedExtraction } from "../apps/api/src/lib/citations";
import { parseLlmFacts } from "../apps/api/src/lib/llm-schema";
import { buildSourceContexts, parseReferencedAmounts, parseReferencedDates } from "../apps/api/src/lib/source-context";
import type { LogEvent } from "../apps/api/src/lib/logger";
import { memoryLimiter } from "../apps/api/src/lib/rate-limit";

const parsed = parseArgs({
  options: {
    input: { type: "string" },
    out: { type: "string" },
    runs: { type: "string", default: "20" },
    model: { type: "string", default: "gemini-3.8-flash" },
    thinking: { type: "string", default: "low" },
  },
});
const options = z
  .object({
    input: z.string().min(1),
    out: z.string().min(1),
    runs: z.coerce.number().int().min(1).max(100),
    model: z.string().regex(/^[a-z0-9.-]+$/),
    thinking: z.enum(["minimal", "low", "medium", "high"]),
  })
  .parse(parsed.values);
const request = AnalyzeRequestSchema.parse(JSON.parse(readFileSync(options.input, "utf8")));
const credentials = z
  .object({ GEMINI_API_KEY: z.string().min(10) })
  .parse(parseEnv(readFileSync("apps/api/.dev.vars", "utf8")));
const Envelope = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
      cachedContentTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});
const ProviderRequest = z.object({
  generationConfig: z.object({
    responseJsonSchema: z.object({
      required: z.array(z.string()),
      properties: z.object({
        amounts: z.object({ items: z.object({ required: z.array(z.string()) }) }).optional(),
        dates: z.object({ items: z.object({ required: z.array(z.string()) }) }).optional(),
      }),
    }),
  }),
});
mkdirSync(dirname(options.out), { recursive: true });
writeFileSync(
  join(dirname(options.out), "scenario.json"),
  `${JSON.stringify(
    {
      ...options,
      input: undefined,
      bytes: Buffer.byteLength(JSON.stringify(request)),
      pages: request.pageCount,
      concurrency: 1,
      environment: "Node createApp with real Gemini; cloud CPU and browser costs measured separately",
      profile: "same provider prompt and validation as Worker",
    },
    null,
    2,
  )}\n`,
);
for (let run = 1; run <= options.runs; run += 1) {
  const calls: {
    ms: number;
    status: number;
    responseBytes: number;
    issuePaths: readonly string[];
    group: string;
    rejectedReferences: readonly { value: number; page: number | null; availablePages: readonly number[] }[];
    usage: z.infer<typeof Envelope>["usageMetadata"];
  }[] = [];
  const logs: LogEvent[] = [];
  const before = process.cpuUsage();
  const started = performance.now();
  const app = createApp({
    now: Date.now,
    uuid: randomUUID,
    logger: { log: (event) => logs.push(event) },
    fallbackLimiter: memoryLimiter(1_000, 60_000, Date.now),
    fetch: async (url, init) => {
      const callStarted = performance.now();
      const response = await fetch(url, init);
      const text = await response.text();
      const envelope = Envelope.safeParse(JSON.parse(text));
      const sentBody = await new Request("https://provider.test", { method: "POST", body: init.body ?? null }).text();
      const providerContract = ProviderRequest.parse(JSON.parse(sentBody)).generationConfig.responseJsonSchema;
      const required = providerContract.required;
      const group = required.includes("summarySentences")
        ? required.includes("amounts")
          ? "full"
          : "facts"
        : required.includes("amounts")
          ? "amounts"
          : "dates";
      let issuePaths: readonly string[] = [];
      let rejectedReferences: readonly { value: number; page: number | null; availablePages: readonly number[] }[] = [];
      const output = envelope.success
        ? envelope.data.candidates?.[0]?.content?.parts
            .filter((part) => part.thought !== true)
            .map((part) => part.text ?? "")
            .join("")
        : undefined;
      if (output !== undefined) {
        try {
          const decoded: unknown = JSON.parse(output);
          const pages = request.pages.map((page) => ({
            number: page.number,
            text: redactSecrets(normalizeText(page.text)).text,
          }));
          const extraction =
            group === "full"
              ? parseCitedExtraction(decoded, pages)
              : group === "facts"
                ? parseLlmFacts(decoded)
                : group === "amounts"
                  ? providerContract.properties.amounts?.items.required.includes("context") === true
                    ? parseCitedAmounts(decoded, pages)
                    : parseReferencedAmounts(decoded, buildSourceContexts(pages))
                  : providerContract.properties.dates?.items.required.includes("context") === true
                    ? parseCitedDates(decoded, pages)
                    : parseReferencedDates(decoded, buildSourceContexts(pages));
          if (!extraction.ok) issuePaths = extraction.issues.map((issue) => issue.path);
          if (!extraction.ok && group === "amounts") {
            const references = z
              .object({ amounts: z.array(z.object({ value: z.number(), page: z.number().nullable() })) })
              .safeParse(decoded);
            const contexts = buildSourceContexts(pages);
            if (references.success)
              rejectedReferences = references.data.amounts
                .filter((_, offset) => issuePaths.some((path) => path.startsWith(`amounts[${offset}]`)))
                .map((item) => ({
                  ...item,
                  availablePages: [...contexts]
                    .filter(([, source]) => source.amounts.has(Math.round(item.value * 100)))
                    .map(([page]) => page),
                }));
          }
        } catch {
          issuePaths = ["(json)"];
        }
      }
      calls.push({
        ms: performance.now() - callStarted,
        status: response.status,
        responseBytes: Buffer.byteLength(text),
        issuePaths,
        group,
        rejectedReferences,
        usage: envelope.success ? envelope.data.usageMetadata : undefined,
      });
      return new Response(text, { status: response.status, headers: response.headers });
    },
  });
  const response = await app.request(
    "/v1/analyze",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
    { ...credentials, GEMINI_MODEL: options.model, GEMINI_THINKING_LEVEL: options.thinking, GEMINI_FALLBACK_MODEL: "" },
  );
  const body: unknown = await response.json();
  const validated = parseAnalysis(body);
  const elapsed = performance.now() - started;
  const cpu = process.cpuUsage(before);
  const memory = process.memoryUsage();
  const result = validated.ok ? validated.value : undefined;
  const sample = {
    run,
    ms: elapsed,
    status: response.status,
    valid: validated.ok,
    calls,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    cpuPercent: (cpu.user + cpu.system) / (elapsed * 10),
    rssMiB: memory.rss / 1_048_576,
    peakRssMiB: process.resourceUsage().maxRSS / 1_024,
    heapMiB: memory.heapUsed / 1_048_576,
    model: result?.meta.model,
    amounts: result?.amounts.length,
    dates: result?.dates.length,
    annex: result?.amounts.some((amount) => amount.value === 13_100),
    injectionFlag: result?.warnings.some((warning) => warning.code === "PROMPT_INJECTION_SUSPECTED"),
    injectedAmount: result?.amounts.some((amount) => amount.value === 1 && amount.currency === "PLN"),
    logs,
  };
  appendFileSync(options.out, `${JSON.stringify(sample)}\n`);
  process.stdout.write(`${JSON.stringify(sample)}\n`);
}
