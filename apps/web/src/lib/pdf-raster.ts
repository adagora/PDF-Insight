import { LIMITS } from "@pdf-insight/shared";
import { PDFDict, PDFName, PDFNumber, PDFObject, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { InspectionError } from "./inspection-model";
import type { PdfObjects } from "./pdf-object-model";

function numeric(dict: PDFDict, key: string, fallback?: number): number {
  const value = dict.lookup(PDFName.of(key));
  if (value === undefined && fallback !== undefined) return fallback;
  if (!(value instanceof PDFNumber)) throw new InspectionError("ATTACHMENT_UNSUPPORTED");
  return value.asNumber();
}

function reconstructRows(
  bytes: Uint8Array,
  width: number,
  height: number,
  channels: number,
  bits: number,
  parameters: PDFObject | undefined,
): Uint8Array {
  if (parameters !== undefined && !(parameters instanceof PDFDict)) throw new InspectionError("ATTACHMENT_UNSUPPORTED");
  const predictor = parameters instanceof PDFDict ? numeric(parameters, "Predictor", 1) : 1;
  const rowBytes = Math.ceil((width * channels * bits) / 8);
  const stride = Math.ceil((channels * bits) / 8);
  if (predictor === 1) {
    if (bytes.length !== rowBytes * height) throw new InspectionError("INSPECTION_FAILED");
    return bytes;
  }
  if (
    !(parameters instanceof PDFDict) ||
    numeric(parameters, "Columns", 1) !== width ||
    numeric(parameters, "Colors", 1) !== channels ||
    numeric(parameters, "BitsPerComponent", 8) !== bits
  )
    throw new InspectionError("ATTACHMENT_UNSUPPORTED");
  if (predictor < 10 || predictor > 15 || bytes.length !== (rowBytes + 1) * height)
    throw new InspectionError("ATTACHMENT_UNSUPPORTED");
  const output = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const filter = bytes[row * (rowBytes + 1)];
    if (filter === undefined || filter > 4) throw new InspectionError("INSPECTION_FAILED");
    for (let column = 0; column < rowBytes; column += 1) {
      const at = row * rowBytes + column;
      const left = column >= stride ? (output[at - stride] ?? 0) : 0;
      const above = row > 0 ? (output[at - rowBytes] ?? 0) : 0;
      const upperLeft = row > 0 && column >= stride ? (output[at - rowBytes - stride] ?? 0) : 0;
      const estimate = left + above - upperLeft;
      const distanceLeft = Math.abs(estimate - left);
      const distanceAbove = Math.abs(estimate - above);
      const distanceUpperLeft = Math.abs(estimate - upperLeft);
      const paeth =
        distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft
          ? left
          : distanceAbove <= distanceUpperLeft
            ? above
            : upperLeft;
      const correction =
        filter === 1
          ? left
          : filter === 2
            ? above
            : filter === 3
              ? Math.floor((left + above) / 2)
              : filter === 4
                ? paeth
                : 0;
      output[at] = (bytes[row * (rowBytes + 1) + column + 1] ?? 0) + correction;
    }
  }
  return output;
}

export function decodeImage(stream: PDFRawStream): PdfObjects["images"][number] {
  const { dict } = stream;
  const width = numeric(dict, "Width");
  const height = numeric(dict, "Height");
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > LIMITS.maxImagePixels
  )
    throw new InspectionError("INSPECTION_LIMIT");
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter === PDFName.of("DCTDecode")) return { kind: "jpeg", bytes: new Uint8Array(stream.getContents()) };
  const color = dict.lookup(PDFName.of("ColorSpace"));
  const mask = dict.lookup(PDFName.of("ImageMask"));
  const channels =
    color === PDFName.of("DeviceRGB")
      ? 3
      : color === PDFName.of("DeviceGray") || mask?.toString() === "true"
        ? 1
        : color === PDFName.of("DeviceCMYK")
          ? 4
          : 0;
  const bits = numeric(dict, "BitsPerComponent", 1);
  if (channels === 0 || (bits !== 8 && !(bits === 1 && channels === 1)) || dict.has(PDFName.of("Decode")))
    throw new InspectionError("ATTACHMENT_UNSUPPORTED");
  const decoded = new Uint8Array(decodePDFRawStream(stream).getBytes(LIMITS.maxDecodedBytes + 1));
  if (decoded.length > LIMITS.maxDecodedBytes) throw new InspectionError("INSPECTION_LIMIT");
  const rows = reconstructRows(decoded, width, height, channels, bits, dict.lookup(PDFName.of("DecodeParms")));
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < width * height; at += 1) {
    const offset = at * channels;
    const gray =
      bits === 1
        ? (((rows[Math.floor(at / width) * Math.ceil(width / 8) + Math.floor((at % width) / 8)] ?? 0) >>
            (7 - ((at % width) % 8))) &
            1) *
          255
        : (rows[offset] ?? 0);
    const black = (rows[offset + 3] ?? 0) / 255;
    pixels[at * 4] =
      channels === 1
        ? gray
        : channels === 4
          ? 255 * (1 - (rows[offset] ?? 0) / 255) * (1 - black)
          : (rows[offset] ?? 0);
    pixels[at * 4 + 1] =
      channels === 1
        ? gray
        : channels === 4
          ? 255 * (1 - (rows[offset + 1] ?? 0) / 255) * (1 - black)
          : (rows[offset + 1] ?? 0);
    pixels[at * 4 + 2] =
      channels === 1
        ? gray
        : channels === 4
          ? 255 * (1 - (rows[offset + 2] ?? 0) / 255) * (1 - black)
          : (rows[offset + 2] ?? 0);
    pixels[at * 4 + 3] = 255;
  }
  return { kind: "pixels", width, height, pixels };
}
