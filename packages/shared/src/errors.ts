export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "ORIGIN_NOT_ALLOWED",
  "RATE_LIMITED",
  "NO_TEXT_LAYER",
  "DOCUMENT_TOO_LONG",
  "AI_INVALID_RESPONSE",
  "AI_UNAVAILABLE",
  "AI_TIMEOUT",
  "NOT_FOUND",
  "INTERNAL",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const API_ERROR_MESSAGES_PL = {
  BAD_REQUEST: "Nieprawidłowe żądanie.",
  VALIDATION_FAILED: "Dane wysłane do analizy mają niepoprawny format.",
  PAYLOAD_TOO_LARGE: "Dokument jest zbyt duży, aby go przeanalizować.",
  UNSUPPORTED_MEDIA_TYPE: "Nieobsługiwany typ danych żądania.",
  ORIGIN_NOT_ALLOWED: "Ta strona nie ma dostępu do API analizy.",
  RATE_LIMITED: "Wysłano zbyt wiele żądań. Odczekaj chwilę i spróbuj ponownie.",
  NO_TEXT_LAYER: "Nie znaleziono tekstu w dokumencie — plik może być pustym skanem.",
  DOCUMENT_TOO_LONG: "Dokument jest zbyt długi, aby przeanalizować go w całości.",
  AI_INVALID_RESPONSE: "Model AI zwrócił niepoprawną odpowiedź, również przy ponownej próbie.",
  AI_UNAVAILABLE: "Usługa AI jest chwilowo niedostępna. Spróbuj ponownie za moment.",
  AI_TIMEOUT: "Analiza trwała zbyt długo i została przerwana.",
  NOT_FOUND: "Nie znaleziono zasobu.",
  INTERNAL: "Wystąpił nieoczekiwany błąd serwera.",
} as const satisfies Record<ApiErrorCode, string>;

export const API_ERROR_STATUS = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  ORIGIN_NOT_ALLOWED: 403,
  RATE_LIMITED: 429,
  NO_TEXT_LAYER: 422,
  DOCUMENT_TOO_LONG: 413,
  AI_INVALID_RESPONSE: 502,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  NOT_FOUND: 404,
  INTERNAL: 500,
} as const satisfies Record<ApiErrorCode, number>;
