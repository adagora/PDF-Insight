import { z } from "zod";

import { API_ERROR_CODES } from "./errors";
import { DOCUMENT_TYPES, ISO_639_1_CODES, isCurrencyCode } from "./iso";
import { LIMITS } from "./limits";
import { countSentences } from "./sentences";

export const SCHEMA_VERSION = "1.0" as const;

const IsoDate = z.iso.date().describe("ISO 8601 calendar date, YYYY-MM-DD.");

export const LanguageCodeSchema = z.enum(ISO_639_1_CODES).describe("ISO 639-1 language code of the document.");

const CurrencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine(isCurrencyCode, "Expected an active ISO 4217 currency code.")
  .describe("ISO 4217 currency code, e.g. PLN, EUR, USD.");

const NonEmptyText = (max: number) => z.string().trim().min(1).max(max);

const PageRef = z
  .number()
  .int()
  .min(1)
  .nullable()
  .optional()
  .describe("1-based page number where the value appears, if known.");

export const DocumentInfoSchema = z
  .object({
    fileName: NonEmptyText(255),
    pages: z.number().int().min(1).max(LIMITS.maxPages),
    language: LanguageCodeSchema,
    type: z.enum(DOCUMENT_TYPES),
    title: NonEmptyText(300).nullable(),
    date: IsoDate.nullable().describe("Main date of the document (ISO 8601) or null."),
  })
  .meta({ id: "DocumentInfo" });

export const AmountSchema = z
  .object({
    value: z.number(),
    currency: CurrencyCode,
    context: NonEmptyText(300).describe(
      "Source excerpt containing the amount and its meaning. When page is provided, copied from that page with whitespace normalized.",
    ),
    page: PageRef,
  })
  .meta({ id: "Amount" });

export const DateItemSchema = z
  .object({
    date: IsoDate,
    context: NonEmptyText(300).describe(
      "Source excerpt containing the date and its meaning. When page is provided, copied from that page with whitespace normalized.",
    ),
    page: PageRef,
  })
  .meta({ id: "DateItem" });

export const WARNING_CODES = [
  "PROMPT_INJECTION_SUSPECTED",
  "SECRETS_REDACTED",
  "AMOUNT_NOT_IN_TEXT",
  "DATE_NOT_IN_TEXT",
  "VALUE_FROM_SCAN",
  "OCR_PAGES",
  "SCAN_PAGES_SKIPPED",
  "DOCUMENT_CHUNKED",
  "FALLBACK_MODEL",
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

export const WarningSchema = z
  .object({
    code: z.enum(WARNING_CODES),
    severity: z.enum(["info", "warning"]),
    message: NonEmptyText(500).describe("Human-readable explanation in Polish."),
    page: PageRef,
    path: z.string().max(100).optional().describe("JSON path of the flagged item, e.g. amounts[3]."),
    excerpt: z.string().max(300).optional().describe("Short quote from the document."),
  })
  .meta({ id: "Warning" });

export const RedactionCountSchema = z.object({
  kind: z.string().min(1).max(40),
  count: z.number().int().min(1),
});

export const InspectionSchema = z.object({
  profile: z.string().min(1).max(100),
  attachments: z.number().int().min(0).max(LIMITS.maxAttachments),
  images: z.number().int().min(0).max(LIMITS.maxInspectedImages),
  barcodes: z.number().int().min(0).max(200),
  metadata: z.number().int().min(0).max(1_000),
  cacheHit: z.boolean(),
  redactions: z.array(RedactionCountSchema).max(30),
});

export type Inspection = z.infer<typeof InspectionSchema>;

export const AnalysisMetaSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    requestId: z.uuid(),
    model: z.string().min(1).max(100),
    generatedAt: z.iso.datetime(),
    durationMs: z.number().int().min(0),
    chunks: z.number().int().min(1),
    ocrPages: z.array(z.number().int().min(1)),
    redactions: z.array(RedactionCountSchema),
    inspection: InspectionSchema.optional(),
  })
  .meta({ id: "AnalysisMeta" });

export const AnalysisResultSchema = z
  .object({
    document: DocumentInfoSchema,
    summary: NonEmptyText(2_000).describe(
      "3–5 sentences in the document language, checked with Unicode sentence segmentation and title-abbreviation tailoring (ADR-0020).",
    ),
    keyPoints: z.array(NonEmptyText(500)).min(3).max(7),
    entities: z.object({
      organizations: z.array(NonEmptyText(300)),
      people: z.array(NonEmptyText(200)),
    }),
    amounts: z.array(AmountSchema),
    dates: z.array(DateItemSchema),
    keywords: z.array(NonEmptyText(80)).max(20),
    warnings: z.array(WarningSchema),
    meta: AnalysisMetaSchema,
  })
  .superRefine((result, ctx) => {
    const count = countSentences(result.summary, result.document.language);
    if (count < 3 || count > 5) {
      ctx.addIssue({ code: "custom", path: ["summary"], message: "Expected 3–5 sentences in the summary." });
    }
  })
  .meta({ id: "AnalysisResult" });

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type Amount = z.infer<typeof AmountSchema>;
export type DateItem = z.infer<typeof DateItemSchema>;
export type AnalysisWarning = z.infer<typeof WarningSchema>;
export type AnalysisMeta = z.infer<typeof AnalysisMetaSchema>;

const ValidatedAnalysisSchema = AnalysisResultSchema.brand<"ValidatedAnalysis">();
export type ValidatedAnalysis = z.infer<typeof ValidatedAnalysisSchema>;

export type SchemaIssue = { readonly path: string; readonly message: string };

export type ParseOutcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

export function toSchemaIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

// oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- I/O boundary parser (ADR-0011)
export function parseAnalysis(input: unknown): ParseOutcome<ValidatedAnalysis> {
  const result = ValidatedAnalysisSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: toSchemaIssues(result.error) };
}

export const PageInputSchema = z.strictObject({
  number: z.number().int().min(1).max(LIMITS.maxPages),
  text: z.string().max(LIMITS.maxPageChars),
  source: z
    .enum(["text", "ocr", "attachment"])
    .optional()
    .describe("Origin of locally inspected text. Binary images are rejected (ADR-0015)."),
});

export const AnalyzeRequestSchema = z
  .strictObject({
    fileName: NonEmptyText(255),
    pageCount: z.number().int().min(1).max(LIMITS.maxPages),
    pages: z.array(PageInputSchema).min(1).max(LIMITS.maxPages),
    inspection: InspectionSchema.optional().describe(
      "Client-reported inspection counts; diagnostic metadata, not authorization or a security proof.",
    ),
  })
  .superRefine((request, ctx) => {
    const seen = new Set<number>();
    for (const [index, page] of request.pages.entries()) {
      if (page.number > request.pageCount) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", index, "number"],
          message: "Page number exceeds pageCount.",
        });
      }
      if (seen.has(page.number)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", index, "number"],
          message: "Duplicate page number.",
        });
      }
      seen.add(page.number);
    }
  })
  .meta({ id: "AnalyzeRequest" });

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type PageInput = z.infer<typeof PageInputSchema>;

export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: z.enum(API_ERROR_CODES),
      message: z.string().describe("Fixed Polish message for the code; never echoes input."),
      requestId: z.string(),
      issues: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional()
        .describe("Validation issues (VALIDATION_FAILED only)."),
    }),
  })
  .meta({ id: "ApiError" });

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthSchema = z.object({ status: z.literal("ok"), version: z.string() }).meta({ id: "Health" });
