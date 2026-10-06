import { z } from "zod";

import { InspectionError } from "./inspection-model";
import { inspectPdfObjects } from "./pdf-object-inspection";
import { PdfObjectCapacitySchema } from "./pdf-object-model";

async function inspect(event: MessageEvent) {
  try {
    const { bytes, capacity } = z
      .object({ bytes: z.instanceof(Uint8Array), capacity: PdfObjectCapacitySchema })
      .parse(event.data);
    const result = await inspectPdfObjects(bytes, capacity);
    self.postMessage({ ok: true, result });
  } catch (cause) {
    self.postMessage({ ok: false, code: cause instanceof InspectionError ? cause.code : "INSPECTION_FAILED" });
  }
}

self.addEventListener("message", (event: MessageEvent) => {
  void inspect(event);
});
