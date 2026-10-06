import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { OPENAPI_CONFIG } from "../src/app";
import { analyzeBody, extraction, fakeGemini, geminiJson, geminiText, httpError, post, testApp } from "./helpers";

const JsonObjectSchema = z.record(z.string(), z.json());
const OpenApiDocSchema = z.object({
  paths: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        responses: z.record(
          z.string(),
          z.object({ content: z.object({ "application/json": z.object({ schema: JsonObjectSchema }) }).optional() }),
        ),
      }),
    ),
  ),
  components: z.object({ schemas: JsonObjectSchema }),
});
type OpenApiDoc = z.infer<typeof OpenApiDocSchema>;

const committedText = readFileSync(join(__dirname, "../../../docs/api/openapi.json"), "utf8");
const committedJson = z.json().parse(JSON.parse(committedText));
const committed = OpenApiDocSchema.parse(committedJson);

function validatorFor(doc: OpenApiDoc, path: string, method: string, status: number) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const schema = doc.paths[path]?.[method]?.responses[String(status)]?.content?.["application/json"]?.schema;
  if (schema === undefined) throw new Error(`${method.toUpperCase()} ${path} documents no ${status} response`);
  return ajv.compile({ ...schema, components: doc.components });
}

async function expectConforms(response: Response, path: string, method: string) {
  const validate = validatorFor(committed, path, method, response.status);
  const body: object = await response.json();
  const valid = validate(body);
  expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([]);
  expect(valid).toBe(true);
}

describe("contract: real responses conform to the committed OpenAPI document (ADR-0006)", () => {
  it("the committed document matches what the app generates", () => {
    const { app } = testApp({ fetch: fakeGemini([]).fetch });
    expect(JSON.parse(JSON.stringify(app.getOpenAPI31Document(OPENAPI_CONFIG)))).toEqual(committedJson);
  });

  it("200 analysis result", async () => {
    const { app } = testApp({ fetch: fakeGemini([geminiJson(extraction())]).fetch });
    await expectConforms(await post(app, analyzeBody()), "/v1/analyze", "post");
  });

  it.each([
    ["422 validation", () => fakeGemini([]), { fileName: "", pageCount: 0, pages: [] }],
    ["422 no text", () => fakeGemini([]), analyzeBody("  ")],
    ["502 invalid AI answer", () => fakeGemini([geminiText("nope")]), analyzeBody()],
    ["503 provider down", () => fakeGemini([httpError(500, "x")]), analyzeBody()],
  ])("%s", async (_label, gemini, body) => {
    const { app } = testApp({ fetch: gemini().fetch });
    await expectConforms(await post(app, body), "/v1/analyze", "post");
  });

  it("every documented error status is one the API can actually return", () => {
    const documented = Object.keys(committed.paths["/v1/analyze"]?.post?.responses ?? {}).map(Number);
    expect(documented.sort()).toEqual([200, 400, 403, 413, 415, 422, 429, 502, 503, 504]);
  });

  it("503 Worker key rejection", async () => {
    const { app } = testApp({ fetch: fakeGemini([httpError(403, "rejected")]).fetch });
    await expectConforms(await post(app, analyzeBody()), "/v1/analyze", "post");
  });
});
