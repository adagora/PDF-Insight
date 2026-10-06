import { createApp, type App } from "../src/app";
import type { Bindings } from "../src/config";
import type { FetchFn } from "../src/lib/gemini";
import type { AnalyzeRequest } from "@pdf-insight/shared";

import type { LlmExtraction } from "../src/lib/llm-schema";
import type { LogEvent } from "../src/lib/logger";
import { memoryLimiter, type RateLimiter } from "../src/lib/rate-limit";

export const ALLOWED_ORIGIN = "http://localhost:5173";

export const TEST_ENV: Bindings = {
  GEMINI_API_KEY: "test-key-not-real-0000",
  ALLOWED_ORIGINS: ALLOWED_ORIGIN,
  GEMINI_MODEL: "primary-model",
  GEMINI_FALLBACK_MODEL: "fallback-model",
};

export function extraction(overrides: Partial<LlmExtraction> = {}): LlmExtraction {
  return {
    language: "pl",
    type: "umowa",
    title: "Umowa serwisowa nr 7/2026",
    date: "2026-03-12",
    summarySentences: [
      "Umowa serwisowa została zawarta 12 marca 2026 r.",
      "Wynagrodzenie wynosi 12 500,00 zł netto miesięcznie",
      "Umowa obowiązuje 12 miesięcy.",
    ],
    keyPoints: ["Wynagrodzenie 12 500 zł netto", "Okres 12 miesięcy", "Płatność w 14 dni"],
    keywords: ["serwis", "SLA", "serwis"],
    organizations: ["Przykład sp. z o.o.", "przykład  sp. z o.o."],
    people: ["Anna Kowalczyk"],
    amounts: [{ value: 12500, currency: "PLN", context: "12 500,00 zł", page: 1 }],
    dates: [{ date: "2026-03-12", context: "12.03.2026", page: 1 }],
    injectionDetected: false,
    injectionExcerpt: null,
    ...overrides,
  };
}

export const DOC_TEXT =
  "Umowa serwisowa nr 7/2026 zawarta dnia 12.03.2026 r. pomiędzy Przykład sp. z o.o. a Anną Kowalczyk. Wynagrodzenie wynosi 12 500,00 zł netto miesięcznie.";

export function analyzeBody(text = DOC_TEXT): AnalyzeRequest {
  return { fileName: "umowa.pdf", pageCount: 1, pages: [{ number: 1, text }] };
}

export type ResponseFactory = () => Response;

export function geminiJson(payload: Partial<LlmExtraction>): ResponseFactory {
  return geminiText(JSON.stringify(payload));
}

export function geminiText(text: string): ResponseFactory {
  const body = JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
  return () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

export function httpError(status: number, body: string): ResponseFactory {
  return () => new Response(body, { status });
}

export function bodyText(init: RequestInit): Promise<string> {
  return new Request("https://gemini.test", { method: "POST", body: init.body ?? null }).text();
}

export type CapturedCall = { readonly url: string; readonly body: string };

export function fakeGemini(responses: readonly ResponseFactory[]) {
  const calls: CapturedCall[] = [];
  let index = 0;
  const fetch: FetchFn = async (input, init) => {
    calls.push({ url: input, body: await bodyText(init) });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next === undefined) throw new Error("fakeGemini: no response queued");
    return next();
  };
  return { fetch, calls };
}

export function testApp(options: { fetch: FetchFn; limiter?: RateLimiter }) {
  const logs: LogEvent[] = [];
  let counter = 0;
  const app = createApp({
    fetch: options.fetch,
    now: () => 1_760_000_000_000 + counter * 10,
    uuid: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    },
    logger: { log: (event) => logs.push(event) },
    fallbackLimiter: options.limiter ?? memoryLimiter(1_000, 60_000, () => 0),
  });
  return { app, logs };
}

function isRawBody(body: AnalyzeRequest | string): body is string {
  return !(body instanceof Object);
}

export function post(
  app: App,
  body: AnalyzeRequest | string,
  init: { headers?: Record<string, string>; env?: Bindings } = {},
) {
  return app.request(
    "/v1/analyze",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: ALLOWED_ORIGIN, ...init.headers },
      body: isRawBody(body) ? body : JSON.stringify(body),
    },
    init.env ?? TEST_ENV,
  );
}
