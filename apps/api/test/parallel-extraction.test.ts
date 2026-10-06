import { ApiErrorSchema, parseAnalysis } from "@pdf-insight/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { PARALLEL_EXTRACTION_CHAR_THRESHOLD } from "../src/lib/extraction";
import { analyzeBody, bodyText, DOC_TEXT, extraction, geminiJson, post, testApp } from "./helpers";

const ProviderRequest = z.object({
  generationConfig: z.object({ responseJsonSchema: z.object({ required: z.array(z.string()) }) }),
});
const largeRequest = () => analyzeBody(`${DOC_TEXT}\n${"Warunki umowy obejmują serwis i wsparcie. ".repeat(400)}`);

describe("concurrent extraction of independent field groups (ADR-0021)", () => {
  it("runs three groups concurrently with the same complete source", async () => {
    let active = 0;
    let maximum = 0;
    const groups: string[][] = [];
    const bodies: string[] = [];
    const { app } = testApp({
      fetch: async (_url, init) => {
        const body = await bodyText(init);
        bodies.push(body);
        groups.push(ProviderRequest.parse(JSON.parse(body)).generationConfig.responseJsonSchema.required);
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return geminiJson(extraction())();
      },
    });
    const request = largeRequest();
    expect(request.pages[0]?.text.length).toBeGreaterThan(PARALLEL_EXTRACTION_CHAR_THRESHOLD);
    const response = await post(app, request);
    expect(response.status).toBe(200);
    expect(parseAnalysis(await response.json()).ok).toBe(true);
    expect(maximum).toBe(3);
    expect(groups).toEqual(expect.arrayContaining([["amounts"], ["dates"]]));
    expect(groups.find((group) => group.includes("summarySentences"))).not.toContain("amounts");
    expect(bodies.every((body) => body.includes("Warunki umowy obejmują serwis i wsparcie"))).toBe(true);
  });

  it.each([true, false])("retries only the invalid amount group, corrected=%s", async (corrected) => {
    const attempts = { facts: 0, amounts: 0, dates: 0 };
    const { app } = testApp({
      fetch: async (_url, init) => {
        const required = ProviderRequest.parse(JSON.parse(await bodyText(init))).generationConfig.responseJsonSchema
          .required;
        if (required.includes("summarySentences")) {
          attempts.facts += 1;
          return geminiJson(extraction())();
        }
        if (required.includes("dates")) {
          attempts.dates += 1;
          return geminiJson(extraction())();
        }
        attempts.amounts += 1;
        return geminiJson(
          extraction({
            amounts:
              corrected && attempts.amounts === 2
                ? extraction().amounts
                : [{ value: 12501, currency: "PLN", context: "invented unsupported quote", page: 1 }],
          }),
        )();
      },
    });
    const response = await post(app, largeRequest());
    expect(response.status).toBe(corrected ? 200 : 502);
    expect(attempts).toEqual({ facts: 1, amounts: 2, dates: 1 });
    if (corrected) expect(parseAnalysis(await response.json()).ok).toBe(true);
    else expect(ApiErrorSchema.parse(await response.json()).error.code).toBe("AI_INVALID_RESPONSE");
  });

  it("cancels unfinished sibling requests when a group fails", async () => {
    let releaseGroups: () => void = () => undefined;
    const groupsStarted = new Promise<void>((resolve) => {
      releaseGroups = resolve;
    });
    let started = 0;
    let cancelled = 0;
    const { app } = testApp({
      fetch: async (_url, init) => {
        const required = ProviderRequest.parse(JSON.parse(await bodyText(init))).generationConfig.responseJsonSchema
          .required;
        if (required.includes("summarySentences")) {
          await groupsStarted;
          return new Response(null, { status: 400 });
        }
        const signal = init.signal;
        if (signal == null) throw new Error("Expected cancellation signal");
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            cancelled += 1;
            reject(new Error("Cancelled sibling request"));
          });
          started += 1;
          if (started === 2) releaseGroups();
        });
      },
    });
    const response = await post(app, largeRequest());
    expect(response.status).toBe(503);
    expect(cancelled).toBe(2);
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe("AI_UNAVAILABLE");
  });
});
