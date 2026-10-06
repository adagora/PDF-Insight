export type PositionedTextItem = {
  readonly str: string;
  readonly hasEOL: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export function joinTextItems(items: readonly PositionedTextItem[]): string {
  let out = "";
  let prev: PositionedTextItem | null = null;
  for (const item of items) {
    if (prev !== null && !out.endsWith("\n")) {
      const size = Math.max(prev.height, item.height, 1);
      const sameLine = Math.abs(item.y - prev.y) < size * 0.5;
      if (!sameLine) {
        out += "\n";
      } else if (!/\s$/.test(out) && !/^\s/.test(item.str) && item.str.length > 0) {
        const gap = item.x - (prev.x + prev.width);
        if (gap > size * 2) out += "   ";
        else if (gap > size * 0.2) out += " ";
      }
    }
    out += item.str;
    if (item.hasEOL) out += "\n";
    if (item.str.length > 0 || item.hasEOL) prev = item;
  }
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

export function isScanPage(text: string, threshold: number): boolean {
  return text.replace(/\s+/g, "").length < threshold;
}
