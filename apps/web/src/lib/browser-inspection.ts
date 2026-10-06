import { LIMITS, joinTextItems } from "@pdf-insight/shared";
import { z } from "zod";
import { InspectionError } from "./inspection-model";
import { imageKind, type InspectionPorts, type DecodedSource, type InspectionContribution } from "./inspection-core";
import type { InspectionCapacity } from "./inspection-budget";
import { createVisualInspector } from "./visual-inspection";
import { readPdfObjects } from "./pdf-objects";
import { pngMetadataTexts } from "./png-metadata";
import { profileInspection } from "./inspection-profile";

const PdfMetadataSchema = z.object({ info: z.json() });
type CollectedContribution = {
  findings: InspectionContribution["findings"][number][];
  metadata: string[];
  barcodes: number;
};
const FileAnnotationSchema = z.object({ filename: z.string(), rawFilename: z.string(), description: z.string() });
const AnnotationsSchema = z.array(
  z.looseObject({
    contentsObj: z.object({ str: z.string() }).optional(),
    fieldValue: z.union([z.string(), z.array(z.string())]).optional(),
    file: FileAnnotationSchema.optional(),
    actions: z.json().optional(),
  }),
);

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

// oxlint-disable-next-line aw-type-evidence/no-unknown-parameters -- metadata decoding boundary
function parseMetadata(input: unknown): string {
  const serialized = JSON.stringify(input ?? null);
  if (serialized.length > LIMITS.maxPageChars) throw new InspectionError("INSPECTION_LIMIT");
  return JSON.stringify(z.json().parse(JSON.parse(serialized)));
}

async function prepareImage(bytes: Uint8Array, signal: AbortSignal) {
  signal.throwIfAborted();
  const mime = imageKind(bytes);
  if (mime === null) throw new InspectionError("ATTACHMENT_UNSUPPORTED");
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: mime });
  const exifr = await import("exifr");
  const value: unknown = await exifr.parse(blob, {
    xmp: true,
    iptc: true,
    icc: true,
    userComment: true,
    reviveValues: false,
  });
  const metadata = [parseMetadata(value), new TextDecoder("iso-8859-1").decode(bytes)];
  if (mime === "image/png") metadata.push(...(await pngMetadataTexts(bytes, signal)));
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width * bitmap.height > LIMITS.maxImagePixels) {
    bitmap.close();
    throw new InspectionError("INSPECTION_LIMIT");
  }
  return {
    metadata,
    decodedBytes: bitmap.width * bitmap.height * 4,
    read: async (visual: ReturnType<typeof createVisualInspector>) => {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      try {
        const context = canvas.getContext("2d");
        if (context === null) throw new InspectionError("INSPECTION_FAILED");
        context.drawImage(bitmap, 0, 0);
        return await visual.inspect(canvas, true);
      } finally {
        canvas.width = 0;
      }
    },
    close: () => bitmap.close(),
  };
}

async function openImage(
  bytes: Uint8Array,
  _capacity: InspectionCapacity,
  signal: AbortSignal,
): Promise<DecodedSource> {
  const image = await prepareImage(bytes, signal);
  let visual: ReturnType<typeof createVisualInspector> | null = null;
  return {
    pageCount: 1,
    imageCount: 1,
    decodedBytes: image.decodedBytes,
    attachments: [],
    metadata: image.metadata,
    findings: [],
    readOriginals: () => Promise.resolve({ metadata: [], findings: [], barcodes: 0 }),
    readPage: async () => {
      visual ??= createVisualInspector(signal);
      const result = await image.read(visual);
      return {
        text: "",
        ocrText: result.text,
        codes: result.codeTexts,
        notes: [],
        findings: result.findings,
        metadata: [],
        barcodes: result.codeTexts.length,
      };
    },
    close: () => {
      visual?.close();
      image.close();
      return Promise.resolve();
    },
  };
}

async function openPdf(bytes: Uint8Array, capacity: InspectionCapacity, signal: AbortSignal): Promise<DecodedSource> {
  const pdfjs = await loadPdfJs();
  signal.throwIfAborted();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    stopAtErrors: true,
    maxImageSize: LIMITS.maxImagePixels,
  });
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  const visuals: ReturnType<typeof createVisualInspector>[] = [];
  const visual = (slot: number) => {
    const existing = visuals[slot];
    if (existing !== undefined) return existing;
    const value = createVisualInspector(signal);
    visuals[slot] = value;
    return value;
  };
  const close = async () => {
    signal.removeEventListener("abort", abort);
    for (const value of visuals) value.close();
    await task.destroy();
  };
  try {
    const pdf = await task.promise;
    if (pdf.numPages > capacity.pages) throw new InspectionError("INSPECTION_LIMIT");
    if (await pdf.hasJSActions()) throw new InspectionError("ATTACHMENT_UNSUPPORTED");
    if ([...(await pdf.getOptionalContentConfig())].length > 0) throw new InspectionError("ATTACHMENT_UNSUPPORTED");
    const metadata = [parseMetadata(PdfMetadataSchema.parse(await pdf.getMetadata()).info)];
    const fields = await pdf.getFieldObjects();
    if (fields !== null) metadata.push(parseMetadata([...fields.values()]));
    const objects = await profileInspection("pdf-objects", () => readPdfObjects(bytes, signal, capacity));
    metadata.push(...objects.attachments.map((attachment) => attachment.name));
    return {
      pageCount: pdf.numPages,
      imageCount: objects.images.length,
      decodedBytes: objects.decodedBytes,
      attachments: objects.attachments,
      metadata,
      findings: objects.findings,
      readOriginals: async (onComplete) => {
        const contribution: CollectedContribution = { findings: [], metadata: [], barcodes: 0 };
        for (const image of objects.images) {
          signal.throwIfAborted();
          if (image.kind === "jpeg") {
            const source = await prepareImage(image.bytes, signal);
            try {
              const result = await source.read(visual(0));
              contribution.findings.push(...result.findings);
              contribution.metadata.push(...source.metadata);
              contribution.barcodes += result.codeTexts.length;
            } finally {
              source.close();
            }
          } else {
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            try {
              const context = canvas.getContext("2d");
              if (context === null) throw new InspectionError("INSPECTION_FAILED");
              context.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
              const result = await visual(0).inspect(canvas, true);
              contribution.findings.push(...result.findings);
              contribution.barcodes += result.codeTexts.length;
            } finally {
              canvas.width = 0;
            }
          }
          onComplete();
        }
        return contribution;
      },
      readPage: async (number, slot) => {
        signal.throwIfAborted();
        const page = await pdf.getPage(number);
        let canvas: HTMLCanvasElement | null = null;
        try {
          const actions = await page.getJSActions();
          if (actions !== null && actions.size > 0) throw new InspectionError("ATTACHMENT_UNSUPPORTED");
          const content = await page.getTextContent();
          const text = joinTextItems(
            content.items.flatMap((item) =>
              "str" in item
                ? [
                    {
                      str: item.str,
                      hasEOL: item.hasEOL,
                      x: Number(item.transform[4] ?? 0),
                      y: Number(item.transform[5] ?? 0),
                      width: item.width,
                      height: item.height > 0 ? item.height : Math.abs(Number(item.transform[3] ?? 0)),
                    },
                  ]
                : [],
            ),
          );
          if (text.length > LIMITS.maxPageChars) throw new InspectionError("INSPECTION_LIMIT");
          const notes: string[] = [];
          const metadata: string[] = [];
          for (const annotation of AnnotationsSchema.parse(await page.getAnnotations())) {
            metadata.push(parseMetadata(annotation));
            if (annotation.actions !== undefined) throw new InspectionError("ATTACHMENT_UNSUPPORTED");
            if (annotation.contentsObj !== undefined) notes.push(annotation.contentsObj.str);
            if (annotation.fieldValue !== undefined)
              notes.push(
                Array.isArray(annotation.fieldValue) ? annotation.fieldValue.join("\n") : annotation.fieldValue,
              );
          }
          const viewport = page.getViewport({ scale: 2 });
          if (viewport.width * viewport.height > LIMITS.maxImagePixels) throw new InspectionError("INSPECTION_LIMIT");
          canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const renderedCanvas = canvas;
          await profileInspection(
            "pdf-render",
            () => page.render({ canvas: renderedCanvas, viewport, background: "#ffffff" }).promise,
          );
          const result = await visual(slot).inspect(canvas, true);
          return {
            text,
            ocrText: result.text,
            codes: result.codeTexts,
            notes,
            findings: result.findings,
            metadata,
            barcodes: result.codeTexts.length,
          };
        } finally {
          if (canvas !== null) canvas.width = 0;
          page.cleanup();
        }
      },
      close,
    };
  } catch (cause) {
    await close();
    if (cause instanceof InspectionError) throw cause;
    if (cause instanceof pdfjs.PasswordException) throw new InspectionError("PDF_ENCRYPTED");
    throw new InspectionError("INSPECTION_FAILED");
  }
}

export const browserInspectionPorts: InspectionPorts = { openPdf, openImage };
