import { parseAnalysis } from "@pdf-insight/shared";
import { describe, expect, it, vi } from "vitest";
import { validResult } from "../../../packages/shared/test/fixtures";
import {
  createWorkflow,
  workflowReducer,
  canRetry,
  type Phase,
  type Action,
  type AnalysisOutcome,
} from "../src/lib/workflow";
import type { ClientErrorCode } from "../src/lib/client-errors";
import { InspectionError, type InspectionResult } from "../src/lib/inspection-model";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function result() {
  const parsed = parseAnalysis(validResult());
  if (!parsed.ok) throw new Error("Invalid fixture");
  return parsed.value;
}

function extracted(): InspectionResult {
  return {
    pageCount: 2,
    pages: [
      { number: 1, text: "First page", source: "ocr" },
      { number: 2, text: "Second page", source: "ocr" },
    ],
    ocrPages: [1, 2],
    inspection: {
      profile: "test",
      attachments: 0,
      images: 0,
      barcodes: 0,
      metadata: 0,
      cacheHit: false,
      redactions: [],
    },
  };
}

function setup() {
  let state: Phase<string> = { kind: "idle", inlineError: null };
  const deps = {
    validate: vi.fn<(file: string) => Promise<ClientErrorCode | null>>(() => Promise.resolve(null)),
    inspect: vi.fn(() => Promise.resolve(extracted())),
    analyze: vi.fn((): Promise<AnalysisOutcome> => Promise.resolve({ ok: true, result: result() })),
    save: vi.fn(),
    now: () => 100,
    emit: vi.fn((action: Action<string>) => {
      state = workflowReducer(state, action);
    }),
  };
  return { deps, workflow: createWorkflow(deps), state: () => state };
}

describe("analysis workflow without React or IO", () => {
  it("owns inspection, request creation, actual OCR count and result saving", async () => {
    const { deps, workflow, state } = setup();
    await workflow.run({ kind: "file", file: "token" }, "umowa.pdf");
    expect(deps.emit.mock.calls.map(([action]) => action.type)).toEqual(["extract", "analyze", "result"]);
    expect(deps.emit).toHaveBeenCalledWith({ type: "analyze", fileName: "umowa.pdf", ocrPages: 2, startedAt: 100 });
    expect(deps.save).toHaveBeenCalledOnce();
    expect(state().kind).toBe("result");
  });
  it("prevents a cancelled validation from resetting a newer result", async () => {
    const { deps, workflow, state } = setup();
    const validation = deferred<ClientErrorCode | null>();
    deps.validate.mockImplementationOnce(() => validation.promise);
    const old = workflow.run({ kind: "file", file: "old" }, "old.pdf");
    await workflow.run({ kind: "file", file: "new" }, "new.pdf");
    validation.resolve("NOT_PDF");
    await old;
    expect(state().kind).toBe("result");
    expect(deps.inspect).toHaveBeenCalledOnce();
    expect(deps.emit).not.toHaveBeenCalledWith({ type: "reset", inlineError: "NOT_PDF" });
  });
  it("suppresses stale inspection results after cancellation", async () => {
    const { deps, workflow, state } = setup();
    const started = deferred<boolean>();
    const inspection = deferred<InspectionResult>();
    deps.inspect.mockImplementationOnce(() => {
      started.resolve(true);
      return inspection.promise;
    });
    const pending = workflow.run({ kind: "file", file: "token" }, "umowa.pdf");
    await started.promise;
    workflow.cancel();
    inspection.resolve(extracted());
    await pending;
    expect(state().kind).toBe("idle");
    expect(deps.analyze).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });
  it("retries failed analysis using the inspected request without repeating extraction", async () => {
    const { deps, workflow, state } = setup();
    deps.analyze.mockResolvedValueOnce({ ok: false, error: { source: "client", code: "NETWORK" } });
    await workflow.run({ kind: "file", file: "token" }, "umowa.pdf");
    const failed = state();
    expect(canRetry(failed)).toBe(true);
    if (failed.kind !== "error" || failed.retry === null) throw new Error("Expected retryable failure");
    await workflow.run(failed.retry, "umowa.pdf");
    expect(deps.inspect).toHaveBeenCalledOnce();
    expect(deps.analyze).toHaveBeenCalledTimes(2);
    expect(state().kind).toBe("result");
  });
  it("blocks analysis and retry on inspection failure", async () => {
    const { deps, workflow, state } = setup();
    deps.inspect.mockRejectedValueOnce(new InspectionError("ATTACHMENT_UNSUPPORTED"));
    await workflow.run({ kind: "file", file: "token" }, "umowa.pdf");
    expect(state().kind).toBe("error");
    expect(canRetry(state())).toBe(false);
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it("ignores progress outside the inspection phase", () => {
    const phase: Phase<string> = { kind: "idle", inlineError: null };
    expect(
      workflowReducer(phase, {
        type: "progress",
        progress: { completed: 1, total: 1, percent: 100, page: 1, totalPages: 1, stage: "complete" },
      }),
    ).toBe(phase);
  });
});
