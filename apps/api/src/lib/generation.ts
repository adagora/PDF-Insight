import type { ParseOutcome } from "@pdf-insight/shared";
import type { JsonSchemaObject } from "./llm-schema";
import type { GeminiPart } from "./prompt";

export type ModelState = { model: string; usedFallback: boolean };

export type GenerateRequest<T> = {
  readonly systemInstruction: string;
  readonly parts: readonly GeminiPart[];
  readonly responseSchema: JsonSchemaObject;
  // oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- receives decoded JSON at the I/O boundary
  readonly parse: (input: unknown) => ParseOutcome<T>;
  readonly signal: AbortSignal;
};

export type GenerationClient = {
  generate<T>(request: GenerateRequest<T>, state: ModelState): Promise<T>;
};
