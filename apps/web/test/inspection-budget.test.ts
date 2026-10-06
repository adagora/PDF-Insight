import { LIMITS } from "@pdf-insight/shared";
import { describe, expect, it } from "vitest";
import { createInspectionBudget } from "../src/lib/inspection-budget";
import { createInspectionProgress } from "../src/lib/inspection-progress";
import type { InspectionProgress } from "../src/lib/inspection-model";

describe("whole inspection tree admission", () => {
  it("charges sibling and nested attachment bytes to the same budget", () => {
    const budget = createInspectionBudget({ ...LIMITS, maxAttachmentBytes: 20 });
    budget.reserve({ pages: 1, images: 0, decodedBytes: 0, attachmentSizes: [8, 8] });
    expect(() => budget.reserve({ pages: 1, images: 0, decodedBytes: 0, attachmentSizes: [5] })).toThrow(
      "INSPECTION_LIMIT",
    );
    expect(budget.capacity().attachmentBytes).toBe(4);
  });
  it.each([
    { maxInspectionPages: 1, input: { pages: 2, images: 0, decodedBytes: 0, attachmentSizes: [] } },
    { maxInspectedImages: 1, input: { pages: 0, images: 2, decodedBytes: 0, attachmentSizes: [] } },
    { maxAttachments: 1, input: { pages: 0, images: 0, decodedBytes: 0, attachmentSizes: [1, 1] } },
    { maxDecodedBytes: 1, input: { pages: 0, images: 0, decodedBytes: 2, attachmentSizes: [] } },
  ])("rejects an exceeded resource without partially reserving others", ({ input, ...limits }) => {
    const budget = createInspectionBudget({ ...LIMITS, ...limits });
    const before = budget.capacity();
    expect(() => budget.reserve(input)).toThrow("INSPECTION_LIMIT");
    expect(budget.capacity()).toEqual(before);
  });
  it("enforces depth and individual file size before decoding", () => {
    const budget = createInspectionBudget();
    expect(() => budget.input(1, 3)).toThrow("INSPECTION_LIMIT");
    expect(() => budget.input(LIMITS.maxFileBytes + 1, 0)).toThrow("INSPECTION_LIMIT");
    expect(() => budget.input(0, 0)).toThrow("INSPECTION_LIMIT");
    expect(() => budget.input(1, 2)).not.toThrow();
  });
});

describe("inspection progress", () => {
  it("counts completions independently of concurrent page order and nested page numbers", () => {
    const events: InspectionProgress[] = [];
    const progress = createInspectionProgress(3, 1, (value) => events.push(value));
    progress.advance(1, "original");
    progress.report("ocr", 2);
    progress.advance(1, "ocr", 2);
    progress.report("ocr", 1);
    progress.advance(1, "ocr", 1);
    progress.advance(1, "attachment", 3);
    expect(events.map((event) => event.percent)).toEqual([25, 25, 50, 50, 75, 100]);
    expect(events.at(-1)?.completed).toBe(4);
  });
});
