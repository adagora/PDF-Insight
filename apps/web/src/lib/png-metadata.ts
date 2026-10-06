import { LIMITS } from "@pdf-insight/shared";

import { InspectionError } from "./inspection-model";

async function inflate(bytes: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  const reader = new Blob([new Uint8Array(bytes).buffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    let finished = false;
    while (!finished) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) {
        finished = true;
        continue;
      }
      size += result.value.length;
      if (size > LIMITS.maxPageChars) throw new InspectionError("INSPECTION_LIMIT");
      parts.push(result.value);
    }
    signal.throwIfAborted();
    const output = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function pngMetadataTexts(bytes: Uint8Array, signal: AbortSignal): Promise<string[]> {
  const strings: string[] = [];
  const view = new DataView(new Uint8Array(bytes).buffer);
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    signal.throwIfAborted();
    const length = view.getUint32(offset);
    if (offset + length + 12 > bytes.length) throw new InspectionError("INSPECTION_FAILED");
    const kind = new TextDecoder("iso-8859-1").decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === "acTL") throw new InspectionError("ATTACHMENT_UNSUPPORTED");
    if (["tEXt", "zTXt", "iTXt", "iCCP"].includes(kind)) {
      const separator = data.indexOf(0);
      if (separator < 1) throw new InspectionError("INSPECTION_FAILED");
      let payload = data.subarray(separator + 1);
      if (kind === "zTXt" || kind === "iCCP") {
        if (payload[0] !== 0) throw new InspectionError("ATTACHMENT_UNSUPPORTED");
        payload = await inflate(payload.subarray(1), signal);
      } else if (kind === "iTXt") {
        const compressed = payload[0];
        if ((compressed !== 0 && compressed !== 1) || payload[1] !== 0)
          throw new InspectionError("ATTACHMENT_UNSUPPORTED");
        const languageEnd = payload.indexOf(0, 2);
        const translationEnd = payload.indexOf(0, languageEnd + 1);
        if (languageEnd < 2 || translationEnd < 0) throw new InspectionError("INSPECTION_FAILED");
        const text = payload.subarray(translationEnd + 1);
        payload = compressed === 1 ? await inflate(text, signal) : text;
      }
      if (payload.length > LIMITS.maxPageChars) throw new InspectionError("INSPECTION_LIMIT");
      strings.push(new TextDecoder(kind === "iTXt" ? "utf-8" : "iso-8859-1", { fatal: true }).decode(payload));
    }
    offset += length + 12;
    if (kind === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || offset !== bytes.length) throw new InspectionError("INSPECTION_FAILED");
  return strings;
}
