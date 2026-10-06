import { LIMITS } from "@pdf-insight/shared";

import type { ClientErrorCode } from "./client-errors";

export type FileFacts = {
  readonly name: string;
  readonly type: string;
  readonly size: number;
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function validateFileFacts(file: FileFacts): ClientErrorCode | null {
  const looksLikePdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!looksLikePdf) return "NOT_PDF";
  if (file.size === 0) return "FILE_EMPTY";
  if (file.size > LIMITS.maxFileBytes) return "FILE_TOO_LARGE";
  return null;
}

export function hasPdfSignature(head: Uint8Array): boolean {
  const window = head.subarray(0, 1024);
  for (let start = 0; start + PDF_MAGIC.length <= window.length; start += 1) {
    if (PDF_MAGIC.every((byte, i) => window[start + i] === byte)) return true;
  }
  return false;
}
