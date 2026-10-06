import { ApiErrorSchema } from "@pdf-insight/shared";
import { describe, expect, it } from "vitest";

import { ALLOWED_ORIGIN, TEST_ENV, analyzeBody, bodyText, extraction, geminiJson, post, testApp } from "./helpers";

const CLIENT_KEY = "browser-test-key-not-real";
const CLIENT_KEY_HEADER = "x-gemini-api-key";

describe("Worker-only Gemini credentials (ADR-0019)", () => {
  it("cannot override the Worker secret through request headers or expose credentials", async () => {
    const authentication: (string | null)[] = [];
    const bodies: string[] = [];
    const urls: string[] = [];
    const { app, logs } = testApp({
      fetch: async (url, init) => {
        authentication.push(new Headers(init.headers).get("x-goog-api-key"));
        bodies.push(await bodyText(init));
        urls.push(url);
        return geminiJson(extraction())();
      },
    });
    const response = await post(app, analyzeBody(), { headers: { [CLIENT_KEY_HEADER]: CLIENT_KEY } });
    expect(response.status).toBe(200);
    const output = await response.text();
    expect((await post(app, analyzeBody())).status).toBe(200);
    expect(authentication).toEqual([TEST_ENV.GEMINI_API_KEY, TEST_ENV.GEMINI_API_KEY]);
    for (const key of [CLIENT_KEY, TEST_ENV.GEMINI_API_KEY]) {
      expect(JSON.stringify({ bodies, urls, logs, output })).not.toContain(key);
    }
  });

  it("cannot compensate for a missing Worker secret with a browser key", async () => {
    let calls = 0;
    const { app } = testApp({
      fetch: () => {
        calls += 1;
        return Promise.resolve(geminiJson(extraction())());
      },
    });
    const response = await post(app, analyzeBody(), {
      env: { ...TEST_ENV, GEMINI_API_KEY: "" },
      headers: { [CLIENT_KEY_HEADER]: CLIENT_KEY },
    });
    expect(response.status).toBe(503);
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe("AI_UNAVAILABLE");
    expect(calls).toBe(0);
  });

  it.each([400, 401, 403])("keeps provider authentication errors private on HTTP %i", async (status) => {
    let calls = 0;
    const { app, logs } = testApp({
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: TEST_ENV.GEMINI_API_KEY } }), { status }),
        );
      },
    });
    const response = await post(app, analyzeBody());
    const error = ApiErrorSchema.parse(await response.json());
    expect(response.status).toBe(503);
    expect(error.error.code).toBe("AI_UNAVAILABLE");
    expect(calls).toBe(1);
    expect(JSON.stringify({ error, logs })).not.toContain(TEST_ENV.GEMINI_API_KEY);
  });

  it("permits only the content-type header in CORS preflights", async () => {
    const { app } = testApp({ fetch: () => Promise.resolve(geminiJson(extraction())()) });
    const response = await app.request(
      "/v1/analyze",
      {
        method: "OPTIONS",
        headers: {
          origin: ALLOWED_ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": `content-type,${CLIENT_KEY_HEADER}`,
        },
      },
      TEST_ENV,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toBe("content-type");
  });
});
