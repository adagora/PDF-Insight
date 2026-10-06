import { PDFHexString, PDFString, hasUtf16BOM, pdfDocEncodingDecode } from "pdf-lib";

const DECODE_CHUNK_BYTES = 8_192;

export function decodePdfString(value: PDFString | PDFHexString): string {
  const bytes = value.asBytes();
  if (hasUtf16BOM(bytes)) return new TextDecoder(bytes[0] === 255 ? "utf-16le" : "utf-16be").decode(bytes);
  const parts: string[] = [];
  for (let at = 0; at < bytes.length; at += DECODE_CHUNK_BYTES) {
    parts.push(pdfDocEncodingDecode(bytes.subarray(at, at + DECODE_CHUNK_BYTES)));
  }
  return parts.join("");
}
