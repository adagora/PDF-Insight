import { PDFHexString, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { decodePdfString } from "../src/lib/pdf-string";

describe("bounded PDF string decoding (ADR-0025)", () => {
  it("retains every PDFDocEncoding mapping across chunk boundaries", () => {
    const text = Array.from({ length: 256 }, (_, at) => String.fromCharCode(at)).join("");
    const value = PDFHexString.of(Buffer.from(text, "latin1").toString("hex"));
    expect(decodePdfString(value)).toBe(value.decodeText());
    const repeat = PDFHexString.of(value.asString().repeat(300));
    expect(decodePdfString(repeat)).toBe(value.decodeText().repeat(300));
  });

  it("preserves PDF escapes and UTF-16 including surrogate pairs and both byte orders", () => {
    const literal = PDFString.of("Literal\\(text\\)\\040and\\nnewline");
    expect(decodePdfString(literal)).toBe(literal.decodeText());
    expect(decodePdfString(PDFHexString.fromText("Łódź 😀"))).toBe("Łódź 😀");
    expect(decodePdfString(PDFHexString.of("fffe41003dd800de"))).toBe("A😀");
    expect(decodePdfString(PDFHexString.fromText("Łódź 😀".repeat(100_000)))).toBe("Łódź 😀".repeat(100_000));
  });
});
