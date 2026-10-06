import { AnalysisResultSchema, ApiErrorSchema, LIMITS } from "@pdf-insight/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { memoryLimiter } from "../src/lib/rate-limit";
import {
  ALLOWED_ORIGIN,
  DOC_TEXT,
  TEST_ENV,
  analyzeBody,
  bodyText,
  extraction,
  fakeGemini,
  geminiJson,
  httpError,
  post,
  testApp,
} from "./helpers";

async function errorOf(response: Response) {
  return ApiErrorSchema.parse(await response.json()).error;
}

describe("HTTP security controls (ADR-0008)", () => {
  it("replaces secret-bearing filenames for direct API callers", async () => {
    const secret = "AKIA" + "Z".repeat(16);
    const gemini = fakeGemini([geminiJson(extraction())]);
    const { app, logs } = testApp({ fetch: gemini.fetch });
    const response = await post(app, { ...analyzeBody(), fileName: `${secret}.pdf` });
    const result = AnalysisResultSchema.parse(await response.json());
    expect(result.document.fileName).toBe("dokument.pdf");
    expect(result.meta.redactions).toContainEqual({ kind: "aws-access-key-id", count: 1 });
    expect(JSON.stringify(logs)).not.toContain(secret);
  });

  it("redacts model-derived partial text before a synthesis call", async () => {
    const secret = "AKIA" + "Z".repeat(16);
    const calls: string[] = [];
    const fetch = async (_url: string, init: RequestInit) => {
      const body = await bodyText(init);
      calls.push(body);
      const synthesis = body.includes("Partial results of all fragments");
      return geminiJson(
        synthesis ? extraction() : extraction({ amounts: [], dates: [], keyPoints: ["Punkt A", secret, "Punkt C"] }),
      )();
    };
    const { app } = testApp({ fetch });
    const response = await post(app, {
      fileName: "chunks.pdf",
      pageCount: 3,
      pages: Array.from({ length: 3 }, (_, index) => ({
        number: index + 1,
        text: `${DOC_TEXT} ${"x ".repeat(25_000)}`,
      })),
    });
    expect(response.status).toBe(200);
    const synthesis = calls.find((body) => body.includes("Partial results of all fragments"));
    expect(synthesis).toBeDefined();
    expect(synthesis).not.toContain(secret);
    expect(synthesis).toContain("[REDACTED:aws-access-key-id]");
  });
  it("rejects binary image fields before Gemini even when calling the API directly", async () => {
    const gemini = fakeGemini([geminiJson(extraction())]);
    const { app } = testApp({ fetch: gemini.fetch });
    const response = await post(
      app,
      JSON.stringify({
        fileName: "scan.pdf",
        pageCount: 1,
        pages: [{ number: 1, text: "", image: { mimeType: "image/png", data: "QUJDRA==" } }],
      }),
    );
    expect(response.status).toBe(422);
    expect(gemini.calls).toHaveLength(0);
  });

  it.each(["ocr", "attachment"] as const)("redacts locally extracted %s credentials before Gemini", async (source) => {
    const secret = "AKIA" + "Z".repeat(16);
    const gemini = fakeGemini([geminiJson(extraction())]);
    const { app, logs } = testApp({ fetch: gemini.fetch });
    const response = await post(app, {
      fileName: "scan.pdf",
      pageCount: 1,
      pages: [{ number: 1, text: `${DOC_TEXT} ${secret}`, source }],
    });
    expect(response.status).toBe(200);
    expect(gemini.calls[0]?.body).not.toContain(secret);
    expect(gemini.calls[0]?.body).toContain("[REDACTED:aws-access-key-id]");
    expect(JSON.stringify(logs)).not.toContain(secret);
  });
  it("allows the configured origin and exposes the request id", async () => {
    const { app } = testApp({ fetch: fakeGemini([geminiJson(extraction())]).fetch });
    const response = await post(app, analyzeBody());
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers a CORS preflight only for allowed origins", async () => {
    const { app } = testApp({ fetch: fakeGemini([geminiJson(extraction())]).fetch });
    const preflight = (origin: string) =>
      app.request(
        "/v1/analyze",
        { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } },
        TEST_ENV,
      );
    expect((await preflight(ALLOWED_ORIGIN)).headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect((await preflight("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses work for a disallowed Origin with 403, without calling Gemini", async () => {
    const gemini = fakeGemini([geminiJson(extraction())]);
    const { app } = testApp({ fetch: gemini.fetch });
    const response = await post(app, analyzeBody(), { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("ORIGIN_NOT_ALLOWED");
    expect(gemini.calls).toHaveLength(0);
  });

  it("rejects non-JSON bodies with 415", async () => {
    const { app } = testApp({ fetch: fakeGemini([geminiJson(extraction())]).fetch });
    const response = await post(app, "hello", { headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(415);
  });

  it("rejects oversized bodies with 413", async () => {
    const { app } = testApp({ fetch: fakeGemini([geminiJson(extraction())]).fetch });
    const response = await post(app, JSON.stringify({ padding: "x".repeat(LIMITS.maxRequestBytes + 1) }));
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects malformed JSON with 400 and schema violations with 422 + issues", async () => {
    const { app } = testApp({ fetch: fakeGemini([geminiJson(extraction())]).fetch });
    expect((await post(app, "{oops")).status).toBe(400);
    const response = await post(app, { fileName: "a.pdf", pageCount: 0, pages: [] });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.issues?.map((i) => i.path)).toEqual(expect.arrayContaining(["pageCount", "pages"]));
  });

  it("rate-limits per client with 429", async () => {
    const { app } = testApp({
      fetch: fakeGemini([geminiJson(extraction())]).fetch,
      limiter: memoryLimiter(2, 60_000, () => 0),
    });
    const headers = { "cf-connecting-ip": "203.0.113.7" };
    expect((await post(app, analyzeBody(), { headers })).status).toBe(200);
    expect((await post(app, analyzeBody(), { headers })).status).toBe(200);
    const limited = await post(app, analyzeBody(), { headers });
    expect(limited.status).toBe(429);
    expect((await post(app, analyzeBody(), { headers: { "cf-connecting-ip": "203.0.113.8" } })).status).toBe(200);
  });

  it("reports AI unavailability when the Worker key is missing", async () => {
    const { app } = testApp({ fetch: fakeGemini([geminiJson(extraction())]).fetch });
    const response = await post(app, analyzeBody(), { env: { ...TEST_ENV, GEMINI_API_KEY: "" } });
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("AI_UNAVAILABLE");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const { app } = testApp({ fetch: fakeGemini([]).fetch });
    const response = await app.request("/nope", {}, TEST_ENV);
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("NOT_FOUND");
  });

  it("never echoes upstream error bodies to the client", async () => {
    const gemini = fakeGemini([httpError(500, "UPSTREAM-INTERNAL-DETAIL")]);
    const { app } = testApp({ fetch: gemini.fetch });
    const response = await post(app, analyzeBody());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("UPSTREAM-INTERNAL-DETAIL");
  });

  it("logs codes and timings only — never document text, file names or AI output", async () => {
    const gemini = fakeGemini([geminiJson(extraction())]);
    const { app, logs } = testApp({ fetch: gemini.fetch });
    await post(app, analyzeBody());
    await post(app, analyzeBody("   "));
    const serialized = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const forbidden of [
      DOC_TEXT.slice(0, 30),
      "umowa.pdf",
      "Umowa serwisowa została",
      TEST_ENV.GEMINI_API_KEY ?? "x",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("serves health and the generated OpenAPI document", async () => {
    const { app } = testApp({ fetch: fakeGemini([]).fetch });
    expect(await (await app.request("/v1/health", {}, TEST_ENV)).json()).toEqual({ status: "ok", version: "0.1.0" });
    const doc = z
      .object({ openapi: z.string(), paths: z.record(z.string(), z.json()) })
      .parse(await (await app.request("/openapi.json", {}, TEST_ENV)).json());
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/v1/analyze", "/v1/health"]));
  });
});
