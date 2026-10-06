import type { DocumentType, ValidatedAnalysis } from "@pdf-insight/shared";

export const DOCUMENT_TYPE_LABELS = {
  faktura: "Faktura",
  umowa: "Umowa",
  oferta: "Oferta",
  raport: "Raport",
  inne: "Inny dokument",
} as const satisfies Record<DocumentType, string>;

const dateFormat = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dateTimeFormat = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" });

export function formatIsoDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

export function formatAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["pl"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} s`;
}

export function exportFileName(result: ValidatedAnalysis): string {
  const base = result.document.fileName
    .replace(/\.pdf$/i, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .slice(0, 120);
  return `${base || "dokument"}.insight.json`;
}

export function toExportJson(result: ValidatedAnalysis): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function downloadJson(result: ValidatedAnalysis): void {
  const blob = new Blob([toExportJson(result)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName(result);
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
