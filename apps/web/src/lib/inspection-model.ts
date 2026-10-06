import { InspectionSchema, PageInputSchema, LIMITS } from "@pdf-insight/shared";
import { z } from "zod";

export const InspectionResultSchema = z.object({
  pageCount: z.number().int().min(1).max(LIMITS.maxPages),
  pages: z.array(PageInputSchema).min(1).max(LIMITS.maxPages),
  ocrPages: z.array(z.number().int().min(1)),
  inspection: InspectionSchema,
});

export type InspectionResult = z.infer<typeof InspectionResultSchema>;

export type InspectionProgress = {
  readonly completed: number;
  readonly total: number | null;
  readonly percent: number | null;
  readonly page: number | null;
  readonly totalPages: number | null;
  readonly stage: "decoding" | "original" | "ocr" | "attachment" | "complete";
};

export class InspectionError extends Error {
  readonly code: "INSPECTION_FAILED" | "INSPECTION_LIMIT" | "ATTACHMENT_UNSUPPORTED" | "PDF_ENCRYPTED" | "PDF_CORRUPT";

  constructor(code: InspectionError["code"]) {
    super(code);
    this.name = "InspectionError";
    this.code = code;
  }
}
