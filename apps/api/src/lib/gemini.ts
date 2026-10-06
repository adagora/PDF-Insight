import { z } from "zod";

import { AppError } from "./errors";
import type { Logger } from "./logger";
import type { JsonSchemaObject } from "./llm-schema";
import { buildRetryPart, type GeminiPart } from "./prompt";
import type { GenerateRequest, ModelState, GenerationClient } from "./generation";

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export type GeminiConfig = {
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModel: string | null;
  readonly thinkingLevel: string | null;
  readonly baseUrl: string;
};

export type GeminiDeps = {
  readonly fetch: FetchFn;
  readonly now: () => number;
  readonly logger: Logger;
  readonly requestId: string;
};

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
});

type AttemptResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "invalid"; readonly issues: readonly { path: string; message: string }[] }
  | { readonly kind: "retryable"; readonly detail: string }
  | { readonly kind: "fatal"; readonly detail: string };

type GenerationConfig = {
  responseMimeType: "application/json";
  responseJsonSchema: JsonSchemaObject;
  temperature: number;
  maxOutputTokens: number;
  thinkingConfig?: { thinkingLevel: string };
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function createGeminiClient(config: GeminiConfig, deps: GeminiDeps): GenerationClient {
  async function attempt<T>(
    model: string,
    request: GenerateRequest<T>,
    attemptNo: number,
    extraParts: readonly GeminiPart[],
  ): Promise<AttemptResult<T>> {
    const started = deps.now();
    const generationConfig: GenerationConfig = {
      responseMimeType: "application/json",
      responseJsonSchema: request.responseSchema,
      temperature: 0.1,
      maxOutputTokens: 16_384,
    };
    if (config.thinkingLevel !== null) {
      generationConfig.thinkingConfig = { thinkingLevel: config.thinkingLevel };
    }

    const log = (status: number, outcome: "ok" | "invalid" | "http_error" | "network_error" | "timeout") =>
      deps.logger.log({
        event: "ai_call",
        requestId: deps.requestId,
        model,
        attempt: attemptNo,
        status,
        ms: deps.now() - started,
        outcome,
      });

    let response: Response;
    try {
      response = await deps.fetch(`${config.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemInstruction }] },
          contents: [{ role: "user", parts: [...request.parts, ...extraParts] }],
          generationConfig,
        }),
        signal: request.signal,
      });
    } catch (cause) {
      if (request.signal.aborted) {
        log(0, "timeout");
        throw new AppError("AI_TIMEOUT", "gemini_deadline", null);
      }
      log(0, "network_error");
      return { kind: "retryable", detail: cause instanceof Error ? `gemini_network_${cause.name}` : "gemini_network" };
    }

    if (!response.ok) {
      log(response.status, "http_error");
      if (!response.bodyUsed) await response.body?.cancel();
      const detail = `gemini_http_${response.status}`;
      return RETRYABLE_STATUS.has(response.status) ? { kind: "retryable", detail } : { kind: "fatal", detail };
    }

    let envelope: z.infer<typeof GeminiResponseSchema>;
    try {
      envelope = GeminiResponseSchema.parse(await response.json());
    } catch {
      log(response.status, "invalid");
      return { kind: "invalid", issues: [{ path: "(root)", message: "Response was not valid JSON." }] };
    }

    const candidate = envelope.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((part) => part.thought !== true)
      .map((part) => part.text ?? "")
      .join("");

    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      log(response.status, "invalid");
      const reason = candidate?.finishReason ?? "UNKNOWN";
      return {
        kind: "invalid",
        issues: [{ path: "(root)", message: `Output is not valid JSON (finishReason ${reason}).` }],
      };
    }

    const parsed = request.parse(decoded);
    if (!parsed.ok) {
      log(response.status, "invalid");
      return { kind: "invalid", issues: parsed.issues };
    }
    log(response.status, "ok");
    return { kind: "ok", value: parsed.value };
  }

  async function generate<T>(request: GenerateRequest<T>, state: ModelState): Promise<T> {
    let attemptNo = 0;
    let validationRetries = 0;
    let extraParts: readonly GeminiPart[] = [];

    for (;;) {
      attemptNo += 1;
      const attemptedModel = state.model;
      const result = await attempt(attemptedModel, request, attemptNo, extraParts);
      switch (result.kind) {
        case "ok":
          return result.value;
        case "invalid":
          if (validationRetries >= 1) throw new AppError("AI_INVALID_RESPONSE", "validation_failed_twice");
          validationRetries += 1;
          extraParts = [buildRetryPart(result.issues)];
          break;
        case "retryable":
          if (state.model !== attemptedModel) break;
          if (!state.usedFallback && config.fallbackModel !== null && config.fallbackModel !== state.model) {
            state.model = config.fallbackModel;
            state.usedFallback = true;
            break;
          }
          throw new AppError("AI_UNAVAILABLE", result.detail);
        case "fatal":
          throw new AppError("AI_UNAVAILABLE", result.detail);
      }
    }
  }

  return { generate };
}
