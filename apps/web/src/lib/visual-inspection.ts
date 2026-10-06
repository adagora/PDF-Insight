import { LIMITS, redactSecrets, type RedactionFinding } from "@pdf-insight/shared";
import { z } from "zod";
import type { Worker as OcrWorker } from "tesseract.js";

import { InspectionError } from "./inspection-model";
import { profileInspection } from "./inspection-profile";

const BarcodeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), texts: z.array(z.string().max(LIMITS.maxPageChars)).max(50) }),
  z.object({ ok: z.literal(false) }),
]);

const OcrSchema = z.object({ data: z.object({ text: z.string().max(LIMITS.maxPageChars), confidence: z.number() }) });

export function createVisualInspector(signal: AbortSignal) {
  const barcodeWorker = new Worker(new URL("./barcode.worker.ts", import.meta.url), { type: "module" });
  let ocr: Promise<OcrWorker> | null = null;
  let closed = false;

  const close = () => {
    closed = true;
    barcodeWorker.terminate();
    if (ocr !== null) void ocr.then((worker) => worker.terminate()).catch(() => undefined);
  };
  signal.addEventListener("abort", close, { once: true });

  const readCodes = (canvas: HTMLCanvasElement): Promise<string[]> =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new InspectionError("INSPECTION_FAILED");
      const abort = () => {
        cleanup();
        reject(new InspectionError("INSPECTION_FAILED"));
      };
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        barcodeWorker.removeEventListener("message", receive);
        barcodeWorker.removeEventListener("error", fail);
      };
      const receive = (event: MessageEvent) => {
        cleanup();
        const result = BarcodeResultSchema.safeParse(event.data);
        if (!result.success || !result.data.ok) reject(new InspectionError("INSPECTION_FAILED"));
        else resolve(result.data.texts);
      };
      const fail = () => {
        cleanup();
        reject(new InspectionError("INSPECTION_FAILED"));
      };
      signal.addEventListener("abort", abort, { once: true });
      barcodeWorker.addEventListener("message", receive);
      barcodeWorker.addEventListener("error", fail);
      barcodeWorker.postMessage({ pixels: context.getImageData(0, 0, canvas.width, canvas.height) });
    });

  const readText = async (canvas: HTMLCanvasElement) => {
    if (ocr === null) {
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      const path = new URL(`${import.meta.env.BASE_URL}inspection/`, window.location.origin).href;
      ocr = profileInspection("ocr-init", () =>
        createWorker(["eng", "pol"], OEM.LSTM_ONLY, {
          workerPath: `${path}worker.min.js`,
          corePath: path,
          langPath: path,
          workerBlobURL: false,
          cacheMethod: "none",
        }).then(async (worker) => {
          if (closed || signal.aborted) {
            await worker.terminate();
            throw new InspectionError("INSPECTION_FAILED");
          }
          await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
          return worker;
        }),
      );
    }
    const worker = await ocr;
    signal.throwIfAborted();
    const result = OcrSchema.parse(
      await profileInspection("ocr-recognize", () => worker.recognize(canvas, {}, { text: true })),
    );
    signal.throwIfAborted();
    return result.data;
  };

  return {
    inspect: async (canvas: HTMLCanvasElement, needsOcr: boolean) => {
      if (canvas.width * canvas.height > LIMITS.maxImagePixels) throw new InspectionError("INSPECTION_LIMIT");
      const codes = await profileInspection("barcode", () => readCodes(canvas));
      const findings: RedactionFinding[] = [];
      const codeTexts = codes.map((text) => {
        const result = redactSecrets(text);
        findings.push(...result.findings);
        return result.text;
      });
      let text = "";
      if (needsOcr) {
        const result = await readText(canvas);
        const sanitized = redactSecrets(result.text);
        findings.push(...sanitized.findings);
        text = sanitized.text;
      }
      return { text, codeTexts, findings };
    },
    close: () => {
      signal.removeEventListener("abort", close);
      close();
    },
  };
}
