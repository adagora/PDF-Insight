import { z } from "zod";

const enabled =
  z
    .enum(["1"])
    .optional()
    .parse(import.meta.env.VITE_PROFILE_INSPECTION) === "1";

type InspectionStage = "ocr-init" | "ocr-recognize" | "barcode" | "pdf-objects" | "pdf-render";

export async function profileInspection<T>(stage: InspectionStage, work: () => Promise<T>): Promise<T> {
  if (!enabled) return work();
  const start = performance.now();
  try {
    return await work();
  } finally {
    performance.measure(`inspection.${stage}`, { start, end: performance.now() });
  }
}
