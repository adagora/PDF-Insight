import { ApiErrorSchema, parseAnalysis, type AnalyzeRequest } from "@pdf-insight/shared";

import type { AnalysisOutcome } from "../lib/workflow";

const CLIENT_TIMEOUT_MS = 60_000;

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

export type { AnalysisOutcome } from "../lib/workflow";

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export async function requestAnalysis(
  body: AnalyzeRequest,
  signal: AbortSignal,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): Promise<AnalysisOutcome> {
  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  const headers = new Headers({ "content-type": "application/json" });
  let response: Response;
  try {
    response = await fetchFn(`${API_URL}/v1/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    return { ok: false, error: { source: "client", code: timeout.aborted ? "TIMEOUT" : "NETWORK" } };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: { source: "client", code: "INVALID_RESPONSE" } };
  }

  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(json);
    return apiError.success
      ? {
          ok: false,
          error: { source: "api", code: apiError.data.error.code, requestId: apiError.data.error.requestId },
        }
      : { ok: false, error: { source: "client", code: "UNKNOWN" } };
  }

  const parsed = parseAnalysis(json);
  return parsed.ok
    ? { ok: true, result: parsed.value }
    : { ok: false, error: { source: "client", code: "INVALID_RESPONSE" } };
}
