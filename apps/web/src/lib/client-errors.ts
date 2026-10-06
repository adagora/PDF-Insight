import type { ApiErrorCode } from "@pdf-insight/shared";

export type ClientErrorCode =
  | "NOT_PDF"
  | "FILE_TOO_LARGE"
  | "FILE_EMPTY"
  | "MULTIPLE_FILES"
  | "PDF_ENCRYPTED"
  | "PDF_CORRUPT"
  | "TOO_MANY_PAGES"
  | "INSPECTION_FAILED"
  | "INSPECTION_LIMIT"
  | "ATTACHMENT_UNSUPPORTED"
  | "NETWORK"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "UNKNOWN";
export type UiError =
  | { readonly source: "client"; readonly code: ClientErrorCode }
  | { readonly source: "api"; readonly code: ApiErrorCode; readonly requestId: string | null };

const NOT_RETRYABLE = new Set<string>([
  "NOT_PDF",
  "FILE_TOO_LARGE",
  "FILE_EMPTY",
  "MULTIPLE_FILES",
  "PDF_ENCRYPTED",
  "PDF_CORRUPT",
  "TOO_MANY_PAGES",
  "INSPECTION_FAILED",
  "INSPECTION_LIMIT",
  "ATTACHMENT_UNSUPPORTED",
  "NO_TEXT_LAYER",
  "DOCUMENT_TOO_LONG",
  "PAYLOAD_TOO_LARGE",
  "ORIGIN_NOT_ALLOWED",
]);

export function isRetryable(error: UiError): boolean {
  return !NOT_RETRYABLE.has(error.code);
}
