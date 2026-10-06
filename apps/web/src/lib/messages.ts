import { API_ERROR_MESSAGES_PL } from "@pdf-insight/shared";

import type { ClientErrorCode, UiError } from "./client-errors";
import type { InspectionProgress } from "./inspection-model";
import type { Phase } from "./workflow";
export { isRetryable, type ClientErrorCode, type UiError } from "./client-errors";

export const CLIENT_ERROR_MESSAGES_PL = {
  NOT_PDF: "To nie jest plik PDF. Wybierz plik z rozszerzeniem .pdf.",
  FILE_TOO_LARGE: "Plik jest większy niż 10 MB. Wybierz mniejszy dokument.",
  FILE_EMPTY: "Plik jest pusty.",
  MULTIPLE_FILES: "Upuść jeden plik PDF naraz.",
  PDF_ENCRYPTED: "Plik PDF jest zabezpieczony hasłem. Usuń zabezpieczenie i spróbuj ponownie.",
  PDF_CORRUPT: "Nie udało się odczytać pliku PDF — może być uszkodzony.",
  TOO_MANY_PAGES: "Dokument ma zbyt wiele stron (maksymalnie 500).",
  INSPECTION_FAILED:
    "Nie udało się bezpiecznie odczytać całego dokumentu. Żadna treść nie została wysłana do AI. Wybierz czytelniejszy plik PDF.",
  INSPECTION_LIMIT:
    "Dokument przekracza limit kontroli: 100 stron, 30 obrazów, 10 załączników lub 2 minuty odczytu. Żadna treść nie została wysłana do AI.",
  ATTACHMENT_UNSUPPORTED:
    "Dokument zawiera nieobsługiwany załącznik, aktywną treść lub dodatkowe warstwy. Żadna treść nie została wysłana do AI. Usuń te elementy i spróbuj ponownie.",
  NETWORK: "Brak połączenia z serwerem analizy. Sprawdź połączenie z internetem i spróbuj ponownie.",
  TIMEOUT: "Serwer analizy nie odpowiedział w wyznaczonym czasie.",
  INVALID_RESPONSE: "Serwer zwrócił wynik w niepoprawnym formacie, więc nie został wyświetlony.",
  UNKNOWN: "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.",
} as const satisfies Record<ClientErrorCode, string>;

export const INSPECTION_MESSAGES_PL = {
  cacheCleared: "Pamięć kontroli została wyczyszczona.",
  cacheDescription: "Powtórny odczyt tego samego pliku korzysta z pamięci tej karty przez 10 minut.",
  clearCache: "Wyczyść pamięć kontroli",
  privacyBeforeProvider: "Plik jest sprawdzany na tym urządzeniu. Do",
  privacyAfterProvider:
    "trafia wyłącznie tekst po ukryciu wykrytych kluczy i haseł. Gdy kontrola nie może się zakończyć, plik jest blokowany. Nie przesyłaj treści, których nie możesz udostępnić zewnętrznej usłudze.",
  title: "Sprawdzam i odczytuję dokument…",
  originalImage: "Sprawdzanie oryginalnego obrazu osadzonego w PDF…",
};

export function messageFor(error: UiError): string {
  return error.source === "client" ? CLIENT_ERROR_MESSAGES_PL[error.code] : API_ERROR_MESSAGES_PL[error.code];
}

export function inspectionProgressText(progress: InspectionProgress | null): string {
  if (progress === null) return "Otwieranie pliku…";
  if (progress.stage === "complete") return "Kontrola dokumentu zakończona.";
  if (progress.total === null)
    return progress.stage === "attachment" ? "Sprawdzanie drzewa załączników…" : "Sprawdzanie struktury dokumentu…";
  if (progress.stage === "original") return INSPECTION_MESSAGES_PL.originalImage;
  if (progress.stage === "attachment") return "Odczyt załączników z pamięci zakończonej kontroli…";
  return `Odczyt obrazu na tym urządzeniu (OCR) · Strona ${progress.page ?? 0} z ${progress.totalPages ?? 0}`;
}

export function workflowStatusText<F>(phase: Phase<F>): string {
  switch (phase.kind) {
    case "idle":
      return phase.inlineError === null ? "" : CLIENT_ERROR_MESSAGES_PL[phase.inlineError];
    case "extracting":
      return inspectionProgressText(phase.progress);
    case "analyzing":
      return "Trwa analiza AI";
    case "result":
      return "Analiza zakończona. Wyniki są gotowe.";
    case "error":
      return `Błąd: ${messageFor(phase.error)}`;
  }
}
