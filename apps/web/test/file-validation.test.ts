import { LIMITS } from "@pdf-insight/shared";
import { describe, expect, it } from "vitest";

import { hasPdfSignature, validateFileFacts } from "../src/lib/file-validation";

describe("validateFileFacts (F-01)", () => {
  it("accepts a PDF by MIME type or extension within the size limit", () => {
    expect(validateFileFacts({ name: "umowa.pdf", type: "application/pdf", size: 1_000 })).toBeNull();
    expect(validateFileFacts({ name: "UMOWA.PDF", type: "", size: 1_000 })).toBeNull();
    expect(validateFileFacts({ name: "skan", type: "application/pdf", size: LIMITS.maxFileBytes })).toBeNull();
  });

  it("rejects other types, empty files and files over 10 MB", () => {
    expect(validateFileFacts({ name: "notes.txt", type: "text/plain", size: 10 })).toBe("NOT_PDF");
    expect(validateFileFacts({ name: "a.pdf", type: "application/pdf", size: 0 })).toBe("FILE_EMPTY");
    expect(validateFileFacts({ name: "a.pdf", type: "application/pdf", size: LIMITS.maxFileBytes + 1 })).toBe(
      "FILE_TOO_LARGE",
    );
  });
});

describe("hasPdfSignature", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("finds %PDF- at the start or within the first kilobyte", () => {
    expect(hasPdfSignature(bytes("%PDF-1.7\n..."))).toBe(true);
    expect(hasPdfSignature(bytes(`${" ".repeat(500)}%PDF-1.4`))).toBe(true);
  });

  it("rejects renamed non-PDF content", () => {
    expect(hasPdfSignature(bytes("PK\u0003\u0004 zip archive"))).toBe(false);
    expect(hasPdfSignature(bytes(`${" ".repeat(1_100)}%PDF-1.4`))).toBe(false);
  });
});
