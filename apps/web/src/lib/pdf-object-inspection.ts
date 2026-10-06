import { LIMITS, redactSecrets, type RedactionFinding } from "@pdf-insight/shared";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFObject,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from "pdf-lib";
import { InspectionError } from "./inspection-model";
import { PdfObjectsSchema, PDF_OBJECT_CAPACITY, type PdfObjects, type PdfObjectCapacity } from "./pdf-object-model";
import { decodeImage } from "./pdf-raster";
import { discoverEmbeddedFiles } from "./pdf-embedded-files";
import { readInlineImages, contentStreams } from "./pdf-inline-images";
import { decodePdfString } from "./pdf-string";

function streamStrings(text: string): string[] {
  const strings: string[] = [];
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === "(") {
      const start = at + 1;
      let depth = 1;
      while (depth > 0 && ++at < text.length) {
        if (text[at] === "\\") at += 1;
        else if (text[at] === "(") depth += 1;
        else if (text[at] === ")") depth -= 1;
      }
      if (depth === 0) strings.push(decodePdfString(PDFString.of(text.slice(start, at))));
    } else if (text[at] === "<" && text[at + 1] !== "<") {
      const end = text.indexOf(">", at + 1);
      if (end > at && /^[\da-fA-F\s]+$/.test(text.slice(at + 1, end))) {
        strings.push(decodePdfString(PDFHexString.of(text.slice(at + 1, end).replace(/\s/g, ""))));
        at = end;
      }
    }
  }
  return strings;
}

export async function inspectPdfObjects(
  bytes: Uint8Array,
  capacity: PdfObjectCapacity = PDF_OBJECT_CAPACITY,
): Promise<PdfObjects> {
  const pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
  const objects = pdf.context.enumerateIndirectObjects();
  if (objects.length > LIMITS.maxPdfObjects) throw new InspectionError("INSPECTION_LIMIT");
  const allObjects = objects.map(([, object]) => object);
  const embeddedFiles = discoverEmbeddedFiles(allObjects);
  if (embeddedFiles.size > capacity.attachments) throw new InspectionError("INSPECTION_LIMIT");
  const pageStreams = contentStreams(allObjects);
  const attachments: PdfObjects["attachments"] = [];
  let attachmentBytes = 0;
  const findings: RedactionFinding[] = [];
  const images: PdfObjects["images"] = [];
  const seen = new Set<PDFObject>();
  let strings = 0;
  let decodedBytes = 0;
  const inspect = (text: string) => {
    decodedBytes += text.length;
    if (decodedBytes > capacity.decodedBytes) throw new InspectionError("INSPECTION_LIMIT");
    strings += 1;
    findings.push(...redactSecrets(text).findings);
  };
  const addImage = (stream: PDFRawStream) => {
    if (images.length >= capacity.images) throw new InspectionError("INSPECTION_LIMIT");
    const image = decodeImage(stream);
    decodedBytes += image.kind === "pixels" ? image.pixels.byteLength : image.bytes.byteLength;
    if (decodedBytes > capacity.decodedBytes) throw new InspectionError("INSPECTION_LIMIT");
    images.push(image);
  };
  const visit = (object: PDFObject, depth: number) => {
    if (seen.has(object)) return;
    seen.add(object);
    if (depth > 50 || seen.size > LIMITS.maxPdfObjects) throw new InspectionError("INSPECTION_LIMIT");
    if (object instanceof PDFInvalidObject) throw new InspectionError("INSPECTION_FAILED");
    if (object instanceof PDFString || object instanceof PDFHexString) inspect(decodePdfString(object));
    else if (object instanceof PDFName) inspect(object.decodeText());
    else if (object instanceof PDFArray) for (const child of object.asArray()) visit(child, depth + 1);
    else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (["JS", "JavaScript", "AA", "XFA", "RichMedia", "OCProperties", "Launch"].includes(key.decodeText()))
          throw new InspectionError("ATTACHMENT_UNSUPPORTED");
        visit(key, depth + 1);
        visit(value, depth + 1);
      }
    } else if (object instanceof PDFRawStream) {
      visit(object.dict, depth + 1);
      if (object.dict.lookup(PDFName.of("Subtype")) === PDFName.of("Image")) {
        addImage(object);
      } else {
        const decoded = decodePDFRawStream(object).getBytes(capacity.decodedBytes - decodedBytes + 1);
        if (decoded.length + decodedBytes > capacity.decodedBytes) throw new InspectionError("INSPECTION_LIMIT");
        const name = embeddedFiles.get(object);
        if (name !== undefined) {
          attachmentBytes += decoded.byteLength;
          if (decoded.length > LIMITS.maxFileBytes || attachmentBytes > capacity.attachmentBytes)
            throw new InspectionError("INSPECTION_LIMIT");
          attachments.push({ name, bytes: new Uint8Array(decoded) });
        }
        if (pageStreams.has(object))
          for (const image of readInlineImages(new Uint8Array(decoded), pdf.context)) addImage(image);
        const text = new TextDecoder("iso-8859-1").decode(decoded);
        inspect(text);
        for (const value of streamStrings(text)) inspect(value);
      }
    }
  };
  for (const [, object] of objects) visit(object, 0);
  if (attachments.length !== embeddedFiles.size) throw new InspectionError("INSPECTION_FAILED");
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + finding.count);
  return PdfObjectsSchema.parse({
    strings,
    decodedBytes,
    images,
    attachments,
    findings: [...counts].map(([kind, count]) => ({ kind, count })),
  });
}
