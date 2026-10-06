import {
  DOCUMENT_TYPES,
  ISO_4217_CODES,
  LanguageCodeSchema,
  completeSentence,
  countSentences,
  toSchemaIssues,
  type ParseOutcome,
} from "@pdf-insight/shared";
import { z } from "zod";

const Text = (max: number) => z.string().min(1).max(max);
const Page = z.number().int().min(1).nullable();

export const LlmAmountSchema = z.object({
  value: z.number(),
  currency: z.enum(ISO_4217_CODES),
  context: Text(300).describe(
    "One contiguous verbatim excerpt from the cited page containing the amount and its meaning; whitespace may be collapsed.",
  ),
  page: Page,
});

export const LlmDateSchema = z.object({
  date: z.iso.date(),
  context: Text(300).describe(
    "One contiguous verbatim excerpt from the cited page containing the date and its meaning; whitespace may be collapsed.",
  ),
  page: Page,
});

const Synthesis = {
  language: LanguageCodeSchema,
  type: z.enum(DOCUMENT_TYPES),
  title: Text(300).nullable(),
  date: z.iso.date().nullable(),
  summarySentences: z
    .array(Text(600).describe("Exactly one factual sentence per entry, in the document language."))
    .min(3)
    .max(5),
  keyPoints: z.array(Text(500)).min(3).max(7),
  keywords: z.array(Text(80)).max(20),
  injectionDetected: z.boolean(),
  injectionExcerpt: z.string().max(300).nullable(),
};

function validateSummary(value: { language: string; summarySentences: readonly string[] }, ctx: z.RefinementCtx): void {
  value.summarySentences.forEach((text, index) => {
    if (countSentences(text, value.language) !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["summarySentences", index],
        message: "Expected exactly one sentence per entry.",
      });
    }
  });
  const count = countSentences(value.summarySentences.map(completeSentence).join(" "), value.language);
  if (count < 3 || count > 5) {
    ctx.addIssue({
      code: "custom",
      path: ["summarySentences"],
      message: "The joined summary must contain 3–5 sentences.",
    });
  }
}

const Facts = {
  ...Synthesis,
  organizations: z.array(Text(300)).max(100),
  people: z.array(Text(200)).max(100),
};

export const LlmFactsSchema = z.object(Facts).superRefine(validateSummary);
export const LlmAmountsSchema = z.object({ amounts: z.array(LlmAmountSchema).max(200) });
export const LlmDatesSchema = z.object({ dates: z.array(LlmDateSchema).max(200) });
export const LlmAmountReferencesSchema = z.object({
  amounts: z.array(LlmAmountSchema.omit({ context: true })).max(200),
});
export const LlmDateReferencesSchema = z.object({ dates: z.array(LlmDateSchema.omit({ context: true })).max(200) });

export const LlmExtractionSchema = z
  .object({
    ...Facts,
    amounts: z.array(LlmAmountSchema).max(200),
    dates: z.array(LlmDateSchema).max(200),
  })
  .superRefine(validateSummary);

export const LlmSynthesisSchema = z.object(Synthesis).superRefine(validateSummary);

export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;
export type LlmSynthesis = z.infer<typeof LlmSynthesisSchema>;
export type LlmAmount = z.infer<typeof LlmAmountSchema>;
export type LlmDate = z.infer<typeof LlmDateSchema>;
export type LlmFacts = z.infer<typeof LlmFactsSchema>;

const MAX_ITEMS_SENT_TO_GEMINI = 20;

const GEMINI_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "description",
  "format",
  "nullable",
  "propertyOrdering",
]);

export type JsonSchemaNode = string | number | boolean | null | readonly JsonSchemaNode[] | JsonSchemaObject;

export type JsonSchemaObject = { readonly [key: string]: JsonSchemaNode };

function isJsonArray(node: JsonSchemaNode): node is readonly JsonSchemaNode[] {
  return Array.isArray(node);
}

function pickGeminiKeywords(node: JsonSchemaNode, parentKey: string | null): JsonSchemaNode {
  if (isJsonArray(node)) return node.map((child) => pickGeminiKeywords(child, null));
  if (node === null || !isJsonObject(node)) return node;
  const out: Record<string, JsonSchemaNode> = {};
  for (const [key, value] of Object.entries(node)) {
    const isField = parentKey === "properties";
    if (!isField && !GEMINI_KEYWORDS.has(key)) continue;
    if (!isField && key === "maxItems" && Number(value) > MAX_ITEMS_SENT_TO_GEMINI) continue;
    out[key] = pickGeminiKeywords(value, key);
  }
  return out;
}

function isJsonObject(node: JsonSchemaNode): node is JsonSchemaObject {
  return node !== null && !Array.isArray(node) && Object.getPrototypeOf(node) === Object.prototype;
}

export function toGeminiSchema(schema: z.ZodType): JsonSchemaObject {
  // SAFETY: z.toJSONSchema returns a plain JSON-serialisable object tree by contract.
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" }) as JsonSchemaObject;
  const picked = pickGeminiKeywords(jsonSchema, null);
  if (picked === null || !isJsonObject(picked)) throw new Error("Gemini schema root must be an object");
  return picked;
}

// oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- I/O boundary parser (ADR-0011)
export function parseLlmExtraction(input: unknown): ParseOutcome<LlmExtraction> {
  const result = LlmExtractionSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: toSchemaIssues(result.error) };
}

// oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- I/O boundary parser (ADR-0011)
export function parseLlmSynthesis(input: unknown): ParseOutcome<LlmSynthesis> {
  const result = LlmSynthesisSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: toSchemaIssues(result.error) };
}

// oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- I/O boundary parser (ADR-0011)
export function parseLlmFacts(input: unknown): ParseOutcome<LlmFacts> {
  const result = LlmFactsSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: toSchemaIssues(result.error) };
}
