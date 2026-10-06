import { z } from "zod";

import type { RateLimitBinding } from "./lib/rate-limit";

export type Bindings = {
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_MODEL?: string;
  readonly GEMINI_FALLBACK_MODEL?: string;
  readonly GEMINI_THINKING_LEVEL?: string;
  readonly GEMINI_BASE_URL?: string;
  readonly ALLOWED_ORIGINS?: string;
  readonly ANALYZE_RATE_LIMITER?: RateLimitBinding;
};

const emptyToNull = (value: string | undefined) => (value === undefined || value.trim() === "" ? null : value.trim());

const ConfigSchema = z.object({
  geminiApiKey: z.string().min(10).nullable(),
  model: z.string().regex(/^[a-z0-9.-]+$/),
  fallbackModel: z
    .string()
    .regex(/^[a-z0-9.-]+$/)
    .nullable(),
  thinkingLevel: z.enum(["minimal", "low", "medium", "high"]).nullable(),
  baseUrl: z.url(),
  allowedOrigins: z.array(z.url()),
});

export type Config = z.infer<typeof ConfigSchema>;

const withDefault = (value: string | undefined, fallback: string) =>
  value === undefined ? fallback : emptyToNull(value);

export const DEFAULTS = {
  model: "gemini-3.8-flash",
  fallbackModel: "gemini-3.5-flash",
  thinkingLevel: "low",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
} as const;

export function parseConfig(env: Bindings | undefined): Config {
  return ConfigSchema.parse({
    geminiApiKey: emptyToNull(env?.GEMINI_API_KEY),
    model: emptyToNull(env?.GEMINI_MODEL) ?? DEFAULTS.model,
    fallbackModel: withDefault(env?.GEMINI_FALLBACK_MODEL, DEFAULTS.fallbackModel),
    thinkingLevel: withDefault(env?.GEMINI_THINKING_LEVEL, DEFAULTS.thinkingLevel),
    baseUrl: emptyToNull(env?.GEMINI_BASE_URL) ?? DEFAULTS.baseUrl,
    allowedOrigins: (env?.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter((origin) => origin.length > 0),
  });
}
