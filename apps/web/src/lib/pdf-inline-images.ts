import { LIMITS } from "@pdf-insight/shared";
import { PDFArray, PDFDict, PDFName, PDFObject, PDFObjectParser, PDFRawStream, PDFContext, PDFNumber } from "pdf-lib";
import { InspectionError } from "./inspection-model";

const KEY_NAMES = new Map([
  ["W", "Width"],
  ["H", "Height"],
  ["BPC", "BitsPerComponent"],
  ["CS", "ColorSpace"],
  ["F", "Filter"],
  ["DP", "DecodeParms"],
  ["D", "Decode"],
  ["IM", "ImageMask"],
  ["I", "Interpolate"],
]);
const VALUE_NAMES = new Map([
  ["G", "DeviceGray"],
  ["RGB", "DeviceRGB"],
  ["CMYK", "DeviceCMYK"],
  ["AHx", "ASCIIHexDecode"],
  ["A85", "ASCII85Decode"],
  ["Fl", "FlateDecode"],
  ["DCT", "DCTDecode"],
]);
const SPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

function token(bytes: Uint8Array, offset: number) {
  let start = offset;
  while (start < bytes.length) {
    if (SPACE.has(bytes[start] ?? -1)) start += 1;
    else if (bytes[start] === 37) {
      while (start < bytes.length && bytes[start] !== 10 && bytes[start] !== 13) start += 1;
    } else break;
  }
  let end = start;
  if (bytes[start] === 40) {
    let depth = 1;
    while (depth > 0 && ++end < bytes.length) {
      if (bytes[end] === 92) end += 1;
      else if (bytes[end] === 40) depth += 1;
      else if (bytes[end] === 41) depth -= 1;
    }
    if (depth !== 0) throw new InspectionError("INSPECTION_FAILED");
    return { start, end: end + 1, word: "" };
  }
  if (bytes[start] === 60 && bytes[start + 1] !== 60) {
    while (end < bytes.length && bytes[end] !== 62) end += 1;
    if (end === bytes.length) throw new InspectionError("INSPECTION_FAILED");
    return { start, end: end + 1, word: "" };
  }
  if (DELIMITERS.has(bytes[start] ?? -1)) {
    end += 1;
    if (bytes[start] !== 47) return { start, end, word: "" };
  }
  while (end < bytes.length && !SPACE.has(bytes[end] ?? -1) && !DELIMITERS.has(bytes[end] ?? -1)) end += 1;
  return { start, end, word: new TextDecoder().decode(bytes.subarray(start, end)) };
}

function dictionary(header: Uint8Array, context: PDFContext): PDFDict {
  const bytes = new Uint8Array(header.length + 4);
  bytes.set([60, 60]);
  bytes.set(header, 2);
  bytes.set([62, 62], header.length + 2);
  const parsed = PDFObjectParser.forBytes(bytes, context).parseObject();
  if (!(parsed instanceof PDFDict)) throw new InspectionError("INSPECTION_FAILED");
  const dict = PDFDict.withContext(context);
  for (const [key, value] of parsed.entries()) {
    const mapped =
      value instanceof PDFName ? PDFName.of(VALUE_NAMES.get(value.decodeText()) ?? value.decodeText()) : value;
    dict.set(PDFName.of(KEY_NAMES.get(key.decodeText()) ?? key.decodeText()), mapped);
  }
  return dict;
}

function rawLength(dict: PDFDict): number {
  const width = dict.lookup(PDFName.of("Width"));
  const height = dict.lookup(PDFName.of("Height"));
  const bits = dict.lookup(PDFName.of("BitsPerComponent"));
  const color = dict.lookup(PDFName.of("ColorSpace"));
  const mask = dict.lookup(PDFName.of("ImageMask"));
  if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) throw new InspectionError("INSPECTION_FAILED");
  const w = width.asNumber();
  const h = height.asNumber();
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > LIMITS.maxImagePixels)
    throw new InspectionError("INSPECTION_LIMIT");
  const channels =
    color === PDFName.of("DeviceRGB")
      ? 3
      : color === PDFName.of("DeviceCMYK")
        ? 4
        : color === PDFName.of("DeviceGray") || mask?.toString() === "true"
          ? 1
          : 0;
  const bpc = bits instanceof PDFNumber ? bits.asNumber() : 1;
  if (channels === 0 || (bpc !== 8 && !(bpc === 1 && channels === 1)))
    throw new InspectionError("ATTACHMENT_UNSUPPORTED");
  return Math.ceil((w * channels * bpc) / 8) * h;
}

export function readInlineImages(bytes: Uint8Array, context: PDFContext): PDFRawStream[] {
  const images: PDFRawStream[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const current = token(bytes, offset);
    if (current.end <= offset) break;
    offset = current.end;
    if (current.word !== "BI") continue;
    const headerStart = offset;
    let item = token(bytes, offset);
    while (item.word !== "ID" && item.end < bytes.length) item = token(bytes, item.end);
    if (item.word !== "ID" || !SPACE.has(bytes[item.end] ?? -1)) throw new InspectionError("INSPECTION_FAILED");
    const dict = dictionary(bytes.subarray(headerStart, item.start), context);
    const start = item.end + (bytes[item.end] === 13 && bytes[item.end + 1] === 10 ? 2 : 1);
    const filter = dict.lookup(PDFName.of("Filter"));
    let end: number;
    if (filter === undefined) end = start + rawLength(dict);
    else if (filter === PDFName.of("ASCIIHexDecode")) {
      end = bytes.indexOf(62, start) + 1;
      if (end <= start) throw new InspectionError("INSPECTION_FAILED");
    } else if (filter === PDFName.of("ASCII85Decode")) {
      end = start;
      while (end + 1 < bytes.length && !(bytes[end] === 126 && bytes[end + 1] === 62)) end += 1;
      end += 2;
    } else throw new InspectionError("ATTACHMENT_UNSUPPORTED");
    if (end > bytes.length || end - start > LIMITS.maxDecodedBytes || !SPACE.has(bytes[end] ?? -1))
      throw new InspectionError("INSPECTION_FAILED");
    const ending = token(bytes, end);
    if (ending.word !== "EI") throw new InspectionError("INSPECTION_FAILED");
    images.push(PDFRawStream.of(dict, new Uint8Array(bytes.subarray(start, end))));
    if (images.length > LIMITS.maxInspectedImages) throw new InspectionError("INSPECTION_LIMIT");
    offset = ending.end;
  }
  return images;
}

export function contentStreams(objects: readonly PDFObject[]): Set<PDFRawStream> {
  const streams = new Set<PDFRawStream>();
  const seen = new Set<PDFObject>();
  const add = (object: PDFObject | undefined) => {
    if (object === undefined || seen.has(object)) return;
    seen.add(object);
    if (object instanceof PDFRawStream) streams.add(object);
    else if (object instanceof PDFArray) for (let at = 0; at < object.size(); at += 1) add(object.lookup(at));
  };
  for (const object of objects) {
    if (object instanceof PDFRawStream && object.dict.lookup(PDFName.of("Subtype")) === PDFName.of("Form")) add(object);
    if (!(object instanceof PDFDict)) continue;
    if (object.lookup(PDFName.of("Type")) === PDFName.of("Page")) add(object.lookup(PDFName.of("Contents")));
    const glyphs = object.lookup(PDFName.of("CharProcs"));
    if (glyphs instanceof PDFDict) for (const [key] of glyphs.entries()) add(glyphs.lookup(key));
  }
  return streams;
}
