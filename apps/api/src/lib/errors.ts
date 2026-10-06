import {
  API_ERROR_MESSAGES_PL,
  API_ERROR_STATUS,
  type ApiError,
  type ApiErrorCode,
  type SchemaIssue,
} from "@pdf-insight/shared";

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly detail: string | null;
  readonly issues: readonly SchemaIssue[] | null;

  constructor(code: ApiErrorCode, detail: string | null = null, issues: readonly SchemaIssue[] | null = null) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.detail = detail;
    this.issues = issues;
  }
}

export function errorBody(error: AppError, requestId: string): ApiError {
  const body: ApiError = {
    error: { code: error.code, message: API_ERROR_MESSAGES_PL[error.code], requestId },
  };
  if (error.issues !== null) body.error.issues = error.issues.slice(0, 20).map((issue) => ({ ...issue }));
  return body;
}

export function statusOf(code: ApiErrorCode): (typeof API_ERROR_STATUS)[ApiErrorCode] {
  return API_ERROR_STATUS[code];
}
