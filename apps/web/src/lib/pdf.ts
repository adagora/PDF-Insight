import { LIMITS, SECRET_PATTERNS } from "@pdf-insight/shared";
import { browserInspectionPorts } from "./browser-inspection";
import { createInspectionCache } from "./inspection-cache";
import { createInspector } from "./inspection-core";
import { InspectionError, type InspectionProgress, type InspectionResult } from "./inspection-model";

export { InspectionError as ExtractionError } from "./inspection-model";
export type ExtractionProgress = InspectionProgress;
export type Extraction = InspectionResult;

const PROFILE_LABEL = "local-v3:pdfjs-6.4.299:pdflib-1.17.1:ocr-7.0.0-eng-pol:zxing-3.1.4";
const PROFILE = `${PROFILE_LABEL}:exifr-7.1.3:data-1.0.0:${JSON.stringify(LIMITS)}:${SECRET_PATTERNS.map((pattern) => `${pattern.kind}:${pattern.regex.source}:${pattern.regex.flags}`).join("|")}`;
const cache = createInspectionCache<InspectionResult>({
  scope: crypto.randomUUID(),
  maxEntries: LIMITS.inspectionCacheEntries,
  maxWeight: LIMITS.inspectionCacheChars,
  ttlMs: LIMITS.inspectionCacheTtlMs,
  now: () => Date.now(),
  weight: (result) => result.pages.reduce((sum, page) => sum + page.text.length, 0),
});
const inspector = createInspector(browserInspectionPorts, cache, { key: PROFILE, label: PROFILE_LABEL });

export function purgeInspectionCache() {
  inspector.purge();
}

export async function extractPdf(
  file: File,
  onProgress: (progress: InspectionProgress) => void,
  signal: AbortSignal,
): Promise<InspectionResult> {
  const deadline = AbortSignal.timeout(LIMITS.inspectionDeadlineMs);
  try {
    signal.throwIfAborted();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await inspector.inspect(bytes, file.name, onProgress, AbortSignal.any([signal, deadline]));
  } catch (cause) {
    if (signal.aborted) throw cause;
    if (deadline.aborted) throw new InspectionError("INSPECTION_LIMIT");
    if (cause instanceof InspectionError) throw cause;
    throw new InspectionError("INSPECTION_FAILED");
  }
}
