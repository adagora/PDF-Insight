import { PDFArray, PDFDict, PDFHexString, PDFName, PDFObject, PDFRawStream, PDFString } from "pdf-lib";
import { InspectionError } from "./inspection-model";
import { LIMITS } from "@pdf-insight/shared";

function fileName(dict: PDFDict): string {
  const value = dict.lookup(PDFName.of("UF")) ?? dict.lookup(PDFName.of("F"));
  if (value === undefined) return "embedded.bin";
  if (!(value instanceof PDFString || value instanceof PDFHexString)) throw new InspectionError("INSPECTION_FAILED");
  return value.decodeText();
}

export function discoverEmbeddedFiles(objects: readonly PDFObject[]): Map<PDFRawStream, string> {
  const files = new Map<PDFRawStream, string>();
  const seen = new Set<PDFObject>();
  const visit = (object: PDFObject, depth = 0) => {
    if (seen.has(object)) return;
    seen.add(object);
    if (depth > 50 || seen.size > LIMITS.maxPdfObjects) throw new InspectionError("INSPECTION_LIMIT");
    if (object instanceof PDFRawStream) {
      if (object.dict.lookup(PDFName.of("Type")) === PDFName.of("EmbeddedFile") && !files.has(object))
        files.set(object, "embedded.bin");
      visit(object.dict, depth + 1);
    } else if (object instanceof PDFArray) {
      for (const child of object.asArray()) visit(child, depth + 1);
    } else if (object instanceof PDFDict) {
      const embedded = object.lookup(PDFName.of("EF"));
      if (object.lookup(PDFName.of("Type")) === PDFName.of("Filespec") && embedded === undefined)
        throw new InspectionError("ATTACHMENT_UNSUPPORTED");
      if (embedded !== undefined) {
        if (!(embedded instanceof PDFDict)) throw new InspectionError("INSPECTION_FAILED");
        if (embedded.entries().length === 0) throw new InspectionError("INSPECTION_FAILED");
        for (const [key] of embedded.entries()) {
          const stream = embedded.lookup(key);
          if (!(stream instanceof PDFRawStream)) throw new InspectionError("ATTACHMENT_UNSUPPORTED");
          files.set(stream, fileName(object));
        }
      }
      for (const [, child] of object.entries()) visit(child, depth + 1);
    }
  };
  for (const object of objects) visit(object);
  return files;
}
