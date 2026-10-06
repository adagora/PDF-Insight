import type { AnalyzeDeps } from "./analyze";
import { parseCitedExtraction } from "./citations";
import type { Chunk } from "./chunking";
import type { ModelState } from "./generation";
import {
  LlmAmountReferencesSchema,
  LlmDateReferencesSchema,
  LlmExtractionSchema,
  LlmFactsSchema,
  parseLlmFacts,
  toGeminiSchema,
} from "./llm-schema";
import { buildDocumentParts, SYSTEM_INSTRUCTION, type FragmentInfo } from "./prompt";
import { buildSourceContexts, parseReferencedAmounts, parseReferencedDates } from "./source-context";

const FULL_SCHEMA = toGeminiSchema(LlmExtractionSchema);
const FACTS_SCHEMA = toGeminiSchema(LlmFactsSchema);
const AMOUNTS_SCHEMA = toGeminiSchema(LlmAmountReferencesSchema);
const DATES_SCHEMA = toGeminiSchema(LlmDateReferencesSchema);
export const PARALLEL_EXTRACTION_CHAR_THRESHOLD = 12_000;

export async function extractChunk(
  chunk: Chunk,
  fragment: FragmentInfo | null,
  deps: Pick<AnalyzeDeps, "gemini" | "nonce" | "signal">,
  state: ModelState,
) {
  const common = { parts: buildDocumentParts(chunk.pages, deps.nonce, fragment), signal: deps.signal };
  if (chunk.chars < PARALLEL_EXTRACTION_CHAR_THRESHOLD) {
    return deps.gemini.generate(
      {
        ...common,
        systemInstruction: SYSTEM_INSTRUCTION,
        responseSchema: FULL_SCHEMA,
        parse: (input) => parseCitedExtraction(input, chunk.pages),
      },
      state,
    );
  }
  const controller = new AbortController();
  const parallel = { ...common, signal: AbortSignal.any([deps.signal, controller.signal]) };
  const contexts = buildSourceContexts(chunk.pages);
  try {
    const [facts, amounts, dates] = await Promise.all([
      deps.gemini.generate(
        {
          ...parallel,
          systemInstruction: `${SYSTEM_INSTRUCTION}\nTASK: Return only document facts, summary, key points, entities, keywords and injection findings in the supplied schema. Do not emit amount/date lists. Each summary array entry must be exactly ONE sentence.`,
          responseSchema: FACTS_SCHEMA,
          parse: parseLlmFacts,
        },
        state,
      ),
      deps.gemini.generate(
        {
          ...parallel,
          systemInstruction: `${SYSTEM_INSTRUCTION}\nTASK: Return only monetary values, currencies and source page numbers in the supplied schema. Do not emit context strings: the server copies them from the source page. Give priority to changed terms in annexes as well as the main contract.`,
          responseSchema: AMOUNTS_SCHEMA,
          parse: (input) => parseReferencedAmounts(input, contexts),
        },
        state,
      ),
      deps.gemini.generate(
        {
          ...parallel,
          systemInstruction: `${SYSTEM_INSTRUCTION}\nTASK: Return only calendar dates and source page numbers in the supplied schema. Do not emit context strings: the server copies them from the source page.`,
          responseSchema: DATES_SCHEMA,
          parse: (input) => parseReferencedDates(input, contexts),
        },
        state,
      ),
    ]);
    return { ...facts, ...amounts, ...dates };
  } catch (error) {
    controller.abort();
    throw error;
  }
}
