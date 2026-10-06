import type { AnalyzeRequest, ValidatedAnalysis } from "@pdf-insight/shared";
import { isRetryable, type ClientErrorCode, type UiError } from "./client-errors";
import { buildAnalysisRequest } from "./inspection-core";
import { InspectionError, type InspectionProgress, type InspectionResult } from "./inspection-model";

export type Retry<F> =
  { readonly kind: "file"; readonly file: F } | { readonly kind: "request"; readonly request: AnalyzeRequest };
export type AnalysisOutcome =
  { readonly ok: true; readonly result: ValidatedAnalysis } | { readonly ok: false; readonly error: UiError };
export type Phase<F> =
  | { readonly kind: "idle"; readonly inlineError: ClientErrorCode | null }
  | {
      readonly kind: "extracting";
      readonly fileName: string;
      readonly progress: InspectionProgress | null;
      readonly startedAt: number;
    }
  | { readonly kind: "analyzing"; readonly fileName: string; readonly ocrPages: number; readonly startedAt: number }
  | { readonly kind: "result"; readonly result: ValidatedAnalysis; readonly origin: "fresh" | "history" }
  | {
      readonly kind: "error";
      readonly error: UiError;
      readonly fileName: string | null;
      readonly retry: Retry<F> | null;
    };
export type Action<F> =
  | { readonly type: "reset"; readonly inlineError?: ClientErrorCode }
  | { readonly type: "extract"; readonly fileName: string; readonly startedAt: number }
  | { readonly type: "progress"; readonly progress: InspectionProgress }
  | { readonly type: "analyze"; readonly fileName: string; readonly ocrPages: number; readonly startedAt: number }
  | { readonly type: "result"; readonly result: ValidatedAnalysis; readonly origin: "fresh" | "history" }
  | {
      readonly type: "fail";
      readonly error: UiError;
      readonly fileName: string | null;
      readonly retry: Retry<F> | null;
    };

export function workflowReducer<F>(phase: Phase<F>, action: Action<F>): Phase<F> {
  switch (action.type) {
    case "reset":
      return { kind: "idle", inlineError: action.inlineError ?? null };
    case "extract":
      return { kind: "extracting", fileName: action.fileName, progress: null, startedAt: action.startedAt };
    case "progress":
      return phase.kind === "extracting" ? { ...phase, progress: action.progress } : phase;
    case "analyze":
      return { kind: "analyzing", fileName: action.fileName, ocrPages: action.ocrPages, startedAt: action.startedAt };
    case "result":
      return { kind: "result", result: action.result, origin: action.origin };
    case "fail":
      return { kind: "error", error: action.error, fileName: action.fileName, retry: action.retry };
  }
}

export function canRetry<F>(phase: Phase<F>): boolean {
  return phase.kind === "error" && phase.retry !== null && isRetryable(phase.error);
}

export function createWorkflow<F>(deps: {
  readonly validate: (file: F) => Promise<ClientErrorCode | null>;
  readonly inspect: (
    file: F,
    emit: (progress: InspectionProgress) => void,
    signal: AbortSignal,
  ) => Promise<InspectionResult>;
  readonly analyze: (request: AnalyzeRequest, signal: AbortSignal) => Promise<AnalysisOutcome>;
  readonly save: (result: ValidatedAnalysis) => void;
  readonly now: () => number;
  readonly emit: (action: Action<F>) => void;
}) {
  let active: AbortController | null = null;
  const stop = () => {
    active?.abort();
    active = null;
  };
  return {
    stop,
    cancel: () => {
      stop();
      deps.emit({ type: "reset" });
    },
    async run(job: Retry<F>, fileName: string) {
      stop();
      const controller = new AbortController();
      active = controller;
      const { signal } = controller;
      let retry = job;
      try {
        let request: AnalyzeRequest;
        if (job.kind === "file") {
          const invalid = await deps.validate(job.file);
          signal.throwIfAborted();
          if (invalid !== null) {
            deps.emit({ type: "reset", inlineError: invalid });
            return;
          }
          deps.emit({ type: "extract", fileName, startedAt: deps.now() });
          const extraction = await deps.inspect(
            job.file,
            (progress) => {
              if (!signal.aborted) deps.emit({ type: "progress", progress });
            },
            signal,
          );
          signal.throwIfAborted();
          request = buildAnalysisRequest(fileName, extraction);
        } else request = job.request;
        retry = { kind: "request", request };
        signal.throwIfAborted();
        deps.emit({
          type: "analyze",
          fileName: request.fileName,
          ocrPages: request.pages.filter((page) => page.source === "ocr").length,
          startedAt: deps.now(),
        });
        const outcome = await deps.analyze(request, signal);
        signal.throwIfAborted();
        if (outcome.ok) {
          deps.save(outcome.result);
          deps.emit({ type: "result", result: outcome.result, origin: "fresh" });
        } else deps.emit({ type: "fail", error: outcome.error, fileName: request.fileName, retry });
      } catch (cause) {
        if (signal.aborted) return;
        const error: UiError =
          cause instanceof InspectionError
            ? { source: "client", code: cause.code }
            : { source: "client", code: "UNKNOWN" };
        deps.emit({ type: "fail", error, fileName, retry });
      } finally {
        if (active === controller) active = null;
      }
    },
  };
}
