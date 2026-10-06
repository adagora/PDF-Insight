import { describe, expect, it } from "vitest";

import { isScanPage, joinTextItems, type PositionedTextItem } from "../src/pdf-text";

const item = (str: string, x: number, y: number, hasEOL = false, width = str.length * 5): PositionedTextItem => ({
  str,
  x,
  y,
  width,
  height: 10,
  hasEOL,
});

describe("joinTextItems", () => {
  it("separates two columns on the same line", () => {
    const text = joinTextItems([
      item("Nordwave Logistics sp. z o.o.", 50, 700),
      item("Kwadrat Software S.A.", 330, 700),
    ]);
    expect(text).toBe("Nordwave Logistics sp. z o.o.   Kwadrat Software S.A.");
  });

  it("inserts a single space for a small gap and nothing for touching items", () => {
    expect(joinTextItems([item("184", 0, 0, false, 15), item("500,00", 18, 0)])).toBe("184 500,00");
    expect(joinTextItems([item("Go-", 0, 0, false, 15), item("live", 15, 0)])).toBe("Go-live");
  });

  it("breaks lines on hasEOL and on vertical movement", () => {
    expect(joinTextItems([item("a", 0, 100, true), item("b", 0, 88), item("c", 0, 70)])).toBe("a\nb\nc");
  });

  it("does not double spaces already present", () => {
    expect(joinTextItems([item("a ", 0, 0, false, 10), item("b", 20, 0)])).toBe("a b");
  });
});

describe("isScanPage", () => {
  it("treats pages with fewer than threshold non-space characters as scans", () => {
    expect(isScanPage(" \n 1 ", 20)).toBe(true);
    expect(isScanPage("Załącznik nr 5", 20)).toBe(true);
    expect(isScanPage("To jest zwykła strona z tekstem.", 20)).toBe(false);
  });
});
