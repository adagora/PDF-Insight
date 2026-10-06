import type { AnalysisWarning, WarningCode } from "@pdf-insight/shared";

const pl = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 });
const list = (pages: readonly number[]) => pages.join(", ");

type WarningInput = {
  readonly page?: number;
  readonly excerpt?: string;
  readonly path?: string;
  readonly pages?: readonly number[];
  readonly kinds?: readonly string[];
  readonly count?: number;
  readonly model?: string;
  readonly date?: string;
  readonly amount?: { readonly value: number; readonly currency: string };
};

const SEVERITY = {
  PROMPT_INJECTION_SUSPECTED: "warning",
  SECRETS_REDACTED: "warning",
  AMOUNT_NOT_IN_TEXT: "warning",
  DATE_NOT_IN_TEXT: "warning",
  VALUE_FROM_SCAN: "info",
  OCR_PAGES: "info",
  SCAN_PAGES_SKIPPED: "warning",
  DOCUMENT_CHUNKED: "info",
  FALLBACK_MODEL: "info",
} as const satisfies Record<WarningCode, "info" | "warning">;

function message(code: WarningCode, input: WarningInput): string {
  switch (code) {
    case "PROMPT_INJECTION_SUSPECTED":
      return "Dokument zawiera fragment wyglądający na polecenie dla systemu AI. Potraktowano go wyłącznie jako treść dokumentu, nie jako instrukcję.";
    case "SECRETS_REDACTED":
      return `Przed wysłaniem do AI ukryto fragmenty wyglądające na dane uwierzytelniające (${(input.kinds ?? []).join(", ")}).`;
    case "AMOUNT_NOT_IN_TEXT":
      return input.amount === undefined
        ? "Tej kwoty nie znaleziono w tekście dokumentu — sprawdź ją w oryginale."
        : `Kwoty ${pl.format(input.amount.value)} ${input.amount.currency} nie znaleziono w tekście dokumentu — sprawdź ją w oryginale.`;
    case "DATE_NOT_IN_TEXT":
      return `Daty ${input.date ?? ""} nie znaleziono w tekście dokumentu — sprawdź ją w oryginale.`;
    case "VALUE_FROM_SCAN":
      return "Wartość odczytano prawdopodobnie ze skanu (OCR) — nie da się jej zweryfikować z warstwą tekstową.";
    case "OCR_PAGES":
      return `Strony ${list(input.pages ?? [])} odczytano z obrazu (OCR) lokalnie w przeglądarce. Do AI wysłano wyłącznie tekst po ukryciu wykrytych kluczy.`;
    case "SCAN_PAGES_SKIPPED":
      return `Strony ${list(input.pages ?? [])} nie zawierają tekstu i nie zostały odczytane (limit OCR).`;
    case "DOCUMENT_CHUNKED":
      return `Dokument był długi — przeanalizowano go w częściach (${input.count ?? 0}) i połączono wyniki.`;
    case "FALLBACK_MODEL":
      return `Główny model AI był niedostępny — użyto modelu zapasowego (${input.model ?? ""}).`;
  }
}

export function warning(code: WarningCode, input: WarningInput): AnalysisWarning {
  const out: AnalysisWarning = { code, severity: SEVERITY[code], message: message(code, input) };
  if (input.page !== undefined) out.page = input.page;
  if (input.path !== undefined) out.path = input.path;
  if (input.excerpt !== undefined && input.excerpt.length > 0) out.excerpt = input.excerpt.slice(0, 300);
  return out;
}
