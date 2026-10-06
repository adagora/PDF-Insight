import { z } from "zod";

import { InspectionError } from "./inspection-model";
import { PdfObjectsSchema, PDF_OBJECT_CAPACITY, type PdfObjects, type PdfObjectCapacity } from "./pdf-object-model";

const ResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: PdfObjectsSchema }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["INSPECTION_FAILED", "INSPECTION_LIMIT", "ATTACHMENT_UNSUPPORTED", "PDF_ENCRYPTED", "PDF_CORRUPT"]),
  }),
]);

export function readPdfObjects(
  bytes: Uint8Array,
  signal: AbortSignal,
  capacity: PdfObjectCapacity = PDF_OBJECT_CAPACITY,
): Promise<PdfObjects> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./pdf-objects.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new InspectionError("INSPECTION_FAILED"));
    };
    worker.addEventListener("error", abort, { once: true });
    worker.addEventListener(
      "message",
      (event: MessageEvent) => {
        cleanup();
        const response = ResponseSchema.safeParse(event.data);
        if (!response.success) reject(new InspectionError("INSPECTION_FAILED"));
        else if (response.data.ok) resolve(response.data.result);
        else reject(new InspectionError(response.data.code));
      },
      { once: true },
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.postMessage({ bytes, capacity });
  });
}
