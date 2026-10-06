import {
  AnalyzeRequestSchema,
  LIMITS,
  redactSecrets,
  type AnalyzeRequest,
  type Inspection,
  type PageInput,
  type RedactionFinding,
} from "@pdf-insight/shared";
import { createInspectionBudget, type InspectionCapacity, type InspectionLimits } from "./inspection-budget";
import { hasPdfSignature } from "./file-policy";
import {
  InspectionError,
  InspectionResultSchema,
  type InspectionProgress,
  type InspectionResult,
} from "./inspection-model";
import { createInspectionProgress, discovering } from "./inspection-progress";

export type InspectionContribution = {
  readonly findings: readonly RedactionFinding[];
  readonly metadata: readonly string[];
  readonly barcodes: number;
};
export type PageReading = InspectionContribution & {
  readonly text: string;
  readonly ocrText: string | null;
  readonly codes: readonly string[];
  readonly notes: readonly string[];
};
export type DecodedSource = {
  readonly pageCount: number;
  readonly imageCount: number;
  readonly decodedBytes: number;
  readonly attachments: readonly { readonly name: string; readonly bytes: Uint8Array }[];
  readonly metadata: readonly string[];
  readonly findings: readonly RedactionFinding[];
  readonly readOriginals: (onComplete: () => void) => Promise<InspectionContribution>;
  readonly readPage: (number: number, slot: number) => Promise<PageReading>;
  readonly close: () => Promise<void>;
};
export type InspectionPorts = {
  readonly openPdf: (bytes: Uint8Array, capacity: InspectionCapacity, signal: AbortSignal) => Promise<DecodedSource>;
  readonly openImage: (bytes: Uint8Array, capacity: InspectionCapacity, signal: AbortSignal) => Promise<DecodedSource>;
};
export type InspectionCache = {
  get(
    bytes: Uint8Array,
    profile: string,
    signal: AbortSignal,
    run: (signal: AbortSignal, generation: number) => Promise<InspectionResult>,
    pendingScope?: string,
    expectedGeneration?: number,
  ): Promise<{ value: InspectionResult; cacheHit: boolean }>;
  purge(): void;
};
type Kind = "pdf" | "image" | "text";
type Plan = {
  readonly bytes: Uint8Array;
  readonly kind: Kind;
  readonly depth: number;
  readonly offset: number;
  readonly source: DecodedSource;
  readonly children: readonly Plan[];
};

export function imageKind(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  return null;
}

function kindOf(bytes: Uint8Array, name: string): Kind {
  if (hasPdfSignature(bytes)) return "pdf";
  if (imageKind(bytes) !== null) return "image";
  if (/\.(txt|md|csv|json)$/i.test(name)) return "text";
  throw new InspectionError("ATTACHMENT_UNSUPPORTED");
}

function textSource(bytes: Uint8Array): DecodedSource {
  const encoding =
    bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8";
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  for (const char of text)
    if ((char.codePointAt(0) ?? 0) < 32 && ![9, 10, 12, 13].includes(char.codePointAt(0) ?? 0))
      throw new InspectionError("ATTACHMENT_UNSUPPORTED");
  return {
    pageCount: 1,
    imageCount: 0,
    decodedBytes: bytes.length,
    attachments: [],
    metadata: [],
    findings: [],
    readOriginals: () => Promise.resolve({ findings: [], metadata: [], barcodes: 0 }),
    readPage: () =>
      Promise.resolve({ text, ocrText: null, codes: [], notes: [], findings: [], metadata: [], barcodes: 0 }),
    close: () => Promise.resolve(),
  };
}

function emptyInspection(profile: string): Inspection {
  return { profile, attachments: 0, images: 0, barcodes: 0, metadata: 0, cacheHit: false, redactions: [] };
}

function addFindings(inspection: Inspection, findings: readonly RedactionFinding[]) {
  for (const finding of findings) {
    const existing = inspection.redactions.find((item) => item.kind === finding.kind);
    if (existing === undefined) inspection.redactions.push({ ...finding });
    else existing.count += finding.count;
  }
}

function addContribution(inspection: Inspection, value: InspectionContribution) {
  inspection.barcodes += value.barcodes;
  addFindings(inspection, value.findings);
  for (const text of value.metadata)
    if (text !== "null" && text !== "{}" && text !== "") {
      inspection.metadata += 1;
      addFindings(inspection, redactSecrets(text).findings);
    }
}

function checkText(result: InspectionResult) {
  if (
    result.pages.some((page) => page.text.length > LIMITS.maxPageChars) ||
    result.pages.reduce((sum, page) => sum + page.text.length, 0) > LIMITS.maxTotalChars
  )
    throw new InspectionError("INSPECTION_LIMIT");
}

function work(plan: Plan): number {
  return (
    plan.source.pageCount +
    (plan.kind === "pdf" ? plan.source.imageCount : 0) +
    plan.children.reduce((sum, child) => sum + work(child), 0)
  );
}

export function buildAnalysisRequest(fileName: string, extraction: InspectionResult): AnalyzeRequest {
  const safeName = redactSecrets(fileName).findings.length > 0 ? "dokument.pdf" : fileName;
  return AnalyzeRequestSchema.parse({
    fileName: safeName,
    pageCount: extraction.pageCount,
    pages: extraction.pages,
    inspection: extraction.inspection,
  });
}

let nextInspectorId = 0;

export function createInspector(
  ports: InspectionPorts,
  cache: InspectionCache,
  profile: { readonly key: string; readonly label: string },
  limits: InspectionLimits = LIMITS,
) {
  const inspectorId = nextInspectorId++;
  let nextJob = 0;
  const admissionProfile = `${profile.key}:${JSON.stringify(limits)}`;
  const inspect = async (
    bytes: Uint8Array,
    name: string,
    emit: (progress: InspectionProgress) => void,
    signal: AbortSignal,
  ): Promise<InspectionResult> => {
    createInspectionBudget(limits).input(bytes.length, 0);
    const kind = kindOf(bytes, name);
    const cached = await cache.get(bytes, `${admissionProfile}:${kind}:0`, signal, async (jobSignal, generation) => {
      const budget = createInspectionBudget(limits);
      const opened: DecodedSource[] = [];
      const jobId = `${inspectorId}:${nextJob++}`;
      let nextOffset = 0;
      let totalImages = 0;
      const admit = async (input: Uint8Array, fileName: string, depth: number): Promise<Plan> => {
        jobSignal.throwIfAborted();
        budget.input(input.length, depth);
        emit(discovering(depth === 0 ? "decoding" : "attachment"));
        const kind = kindOf(input, fileName);
        const source =
          kind === "pdf"
            ? await ports.openPdf(input, budget.capacity(), jobSignal)
            : kind === "image"
              ? await ports.openImage(input, budget.capacity(), jobSignal)
              : textSource(input);
        opened.push(source);
        budget.reserve({
          pages: source.pageCount,
          images: source.imageCount,
          decodedBytes: source.decodedBytes,
          attachmentSizes: source.attachments.map((attachment) => attachment.bytes.length),
        });
        const offset = nextOffset;
        nextOffset += source.pageCount;
        if (kind === "pdf") totalImages += source.imageCount;
        const children: Plan[] = [];
        for (const attachment of source.attachments)
          children.push(await admit(attachment.bytes, attachment.name, depth + 1));
        return { bytes: input, kind, depth, offset, source, children };
      };
      try {
        const plan = await admit(bytes, name, 0);
        const progress = createInspectionProgress(nextOffset, totalImages, emit);
        const execute = async (node: Plan): Promise<InspectionResult> => {
          jobSignal.throwIfAborted();
          const inspection = emptyInspection(profile.label);
          inspection.images = node.source.imageCount;
          inspection.attachments = node.children.length;
          addContribution(inspection, { metadata: node.source.metadata, findings: node.source.findings, barcodes: 0 });
          if (node.kind === "pdf" && node.source.imageCount > 0) progress.report("original");
          addContribution(inspection, await node.source.readOriginals(() => progress.advance(1, "original")));
          const pages: PageInput[] = [];
          let nextPage = 1;
          const readPages = async (slot: number) => {
            while (nextPage <= node.source.pageCount) {
              jobSignal.throwIfAborted();
              const number = nextPage++;
              progress.report("ocr", node.offset + number);
              const reading = await node.source.readPage(number, slot);
              addContribution(inspection, reading);
              const redacted = redactSecrets(
                [
                  reading.text,
                  reading.ocrText ?? "",
                  ...reading.notes,
                  ...reading.codes.map((code) => `Kod: ${code}`),
                ].join("\n"),
              );
              addFindings(inspection, redacted.findings);
              const text = redacted.text.trim();
              if (text.length === 0 && node.kind !== "text") throw new InspectionError("INSPECTION_FAILED");
              pages[number - 1] = { number, text, source: reading.ocrText === null ? "attachment" : "ocr" };
              if (text.length > LIMITS.maxPageChars) throw new InspectionError("INSPECTION_LIMIT");
              progress.advance(1, "ocr", node.offset + number);
            }
          };
          await Promise.all([readPages(0), readPages(1)]);
          for (const child of node.children) {
            const result = await cache.get(
              child.bytes,
              `${admissionProfile}:${child.kind}:${child.depth}`,
              jobSignal,
              () => execute(child),
              jobId,
              generation,
            );
            if (result.cacheHit) progress.advance(work(child), "attachment");
            const value = result.value;
            inspection.attachments += value.inspection.attachments;
            inspection.images += value.inspection.images;
            inspection.metadata += value.inspection.metadata;
            inspection.barcodes += value.inspection.barcodes;
            addFindings(inspection, value.inspection.redactions);
            for (const page of value.pages)
              pages.push({ ...page, number: pages.length + 1, text: `[Załącznik]\n${page.text}` });
          }
          const value: InspectionResult = {
            pageCount: pages.length,
            pages,
            ocrPages: pages.filter((page) => page.source === "ocr").map((page) => page.number),
            inspection,
          };
          checkText(value);
          return InspectionResultSchema.parse(value);
        };
        const result = await execute(plan);
        progress.report("complete");
        return result;
      } finally {
        await Promise.all(opened.map((source) => source.close()));
      }
    });
    cached.value.inspection.cacheHit = cached.cacheHit;
    addContribution(cached.value.inspection, { metadata: [name], findings: [], barcodes: 0 });
    if (cached.cacheHit)
      emit({ completed: 1, total: 1, percent: 100, page: null, totalPages: cached.value.pageCount, stage: "complete" });
    return InspectionResultSchema.parse(cached.value);
  };
  return { inspect, purge: () => cache.purge() };
}
