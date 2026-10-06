import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  AnalysisResultSchema,
  AnalyzeRequestSchema,
  ApiErrorSchema,
  HealthSchema,
  LIMITS,
  toSchemaIssues,
} from "@pdf-insight/shared";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";

import { parseConfig, type Bindings, type Config } from "./config";
import { analyzeDocument } from "./lib/analyze";
import { AppError, errorBody, statusOf } from "./lib/errors";
import { createGeminiClient, type FetchFn } from "./lib/gemini";
import type { Logger } from "./lib/logger";
import { bindingLimiter, type RateLimiter } from "./lib/rate-limit";

export const API_VERSION = "0.1.0";

export const OPENAPI_CONFIG = {
  openapi: "3.1.0",
  info: {
    title: "PDF Insight API",
    version: API_VERSION,
    description:
      "Proxy between the PDF Insight web app and Google Gemini. Receives locally inspected text from PDFs, OCR and attachments; binary images are rejected. Returns a validated summary and structured data (brief §04). Generated from the Zod schemas — do not edit by hand (ADR-0006).",
  },
  servers: [{ url: "http://localhost:8787", description: "Local (wrangler dev)" }],
};

export type AppDeps = {
  readonly fetch: FetchFn;
  readonly now: () => number;
  readonly uuid: () => string;
  readonly logger: Logger;
  readonly fallbackLimiter: RateLimiter;
};

type AppEnv = { Bindings: Bindings; Variables: { requestId: string; config: Config } };

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ApiErrorSchema } },
});

const analyzeRoute = createRoute({
  method: "post",
  path: "/v1/analyze",
  operationId: "analyzeDocument",
  tags: ["analysis"],
  summary: "Summarise a document and extract structured data",
  description: `Validates the whole text-only request, redacts credentials, detects prompt-injection attempts, then asks Gemini for a schema-constrained extraction (retry once on an invalid answer). Gemini authentication uses only the Worker secret; clients provide no credentials. Binary images are rejected. Amounts and dates are grounded against source text, including local OCR. Limits: body ≤ ${LIMITS.maxRequestBytes} bytes, ≤ ${LIMITS.maxPages} pages, ≤ ${LIMITS.maxTotalChars} characters.`,
  request: {
    body: { required: true, content: { "application/json": { schema: AnalyzeRequestSchema } } },
  },
  responses: {
    200: {
      description: "Validated analysis result (brief §04 schema plus `warnings` and `meta`).",
      content: { "application/json": { schema: AnalysisResultSchema } },
    },
    400: errorResponse("BAD_REQUEST — malformed JSON."),
    403: errorResponse("ORIGIN_NOT_ALLOWED — Origin header not on the allow-list."),
    413: errorResponse("PAYLOAD_TOO_LARGE / DOCUMENT_TOO_LONG."),
    415: errorResponse("UNSUPPORTED_MEDIA_TYPE — body must be application/json."),
    422: errorResponse("VALIDATION_FAILED (with issues) / NO_TEXT_LAYER."),
    429: errorResponse("RATE_LIMITED."),
    502: errorResponse("AI_INVALID_RESPONSE — invalid AI answer after one retry."),
    503: errorResponse("AI_UNAVAILABLE — provider error, including after fallback."),
    504: errorResponse("AI_TIMEOUT — deadline exceeded."),
  },
});

const healthRoute = createRoute({
  method: "get",
  path: "/v1/health",
  operationId: "health",
  tags: ["meta"],
  summary: "Liveness check",
  responses: { 200: { description: "Service is up.", content: { "application/json": { schema: HealthSchema } } } },
});

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw new AppError("VALIDATION_FAILED", "request_schema", toSchemaIssues(result.error));
    },
  });

  app.use("*", async (c, next) => {
    const requestId = deps.uuid();
    const started = deps.now();
    c.set("requestId", requestId);
    await next();
    c.res.headers.set("X-Request-Id", requestId);
    c.res.headers.set("Cache-Control", "no-store");
    deps.logger.log({
      event: "request",
      requestId,
      method: c.req.method,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Hono types the middleware Context input generic as any
      route: routePath(c),
      status: c.res.status,
      ms: deps.now() - started,
    });
  });

  app.use("*", async (c, next) => {
    c.set("config", parseConfig(c.env));
    await next();
  });

  app.use("*", secureHeaders({ crossOriginResourcePolicy: "cross-origin" }));

  app.use(
    "*",
    cors({
      origin: (origin, c: Context<AppEnv>) => (c.get("config").allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      exposeHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );

  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined && !c.get("config").allowedOrigins.includes(origin)) {
      throw new AppError("ORIGIN_NOT_ALLOWED");
    }
    await next();
  });

  app.use("/v1/analyze", async (c, next) => {
    if (c.req.method !== "POST") return next();
    const limiter =
      c.env.ANALYZE_RATE_LIMITER === undefined ? deps.fallbackLimiter : bindingLimiter(c.env.ANALYZE_RATE_LIMITER);
    const clientKey = c.req.header("cf-connecting-ip") ?? "local";
    if (!(await limiter.allow(clientKey))) throw new AppError("RATE_LIMITED");
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new AppError("UNSUPPORTED_MEDIA_TYPE");
    }
    return next();
  });
  app.use(
    "/v1/analyze",
    bodyLimit({
      maxSize: LIMITS.maxRequestBytes,
      onError: () => {
        throw new AppError("PAYLOAD_TOO_LARGE");
      },
    }),
  );

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const, version: API_VERSION }, 200));

  app.openapi(analyzeRoute, async (c) => {
    const request = c.req.valid("json");
    const config = c.get("config");
    const apiKey = config.geminiApiKey;
    if (apiKey === null) throw new AppError("AI_UNAVAILABLE", "config_missing_gemini_key");

    const requestId = c.get("requestId");
    const signal = AbortSignal.any([AbortSignal.timeout(LIMITS.aiDeadlineMs), c.req.raw.signal]);
    const gemini = createGeminiClient(
      {
        apiKey,
        model: config.model,
        fallbackModel: config.fallbackModel,
        thinkingLevel: config.thinkingLevel,
        baseUrl: config.baseUrl,
      },
      { fetch: deps.fetch, now: deps.now, logger: deps.logger, requestId },
    );
    const result = await analyzeDocument(request, {
      gemini,
      primaryModel: config.model,
      now: deps.now,
      requestId,
      nonce: deps.uuid().replaceAll("-", ""),
      signal,
    });
    return c.json(result, 200);
  });

  app.doc31("/openapi.json", OPENAPI_CONFIG);

  app.notFound(() => {
    throw new AppError("NOT_FOUND");
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId");
    let appError: AppError;
    if (err instanceof AppError) appError = err;
    else if (err instanceof HTTPException && err.status === 400)
      appError = new AppError("BAD_REQUEST", "malformed_body");
    else appError = new AppError("INTERNAL", `unhandled_${err.name}`);
    deps.logger.log({ event: "error", requestId, code: appError.code, detail: appError.detail });
    return c.json(errorBody(appError, requestId), statusOf(appError.code));
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
