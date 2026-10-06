import type { ClientErrorCode } from "./client-errors";
import { validateFileFacts, hasPdfSignature } from "./file-policy";
export { validateFileFacts, hasPdfSignature, type FileFacts } from "./file-policy";

export async function validateFile(file: File): Promise<ClientErrorCode | null> {
  const factsError = validateFileFacts(file);
  if (factsError !== null) return factsError;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return hasPdfSignature(head) ? null : "NOT_PDF";
}
