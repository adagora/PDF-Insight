import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { pngMetadataTexts } from "../src/lib/png-metadata";

function chunk(kind: string, bytes: Uint8Array): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(bytes.length);
  header.write(kind, 4, "ascii");
  return Buffer.concat([header, bytes, Buffer.alloc(4)]);
}

function png(...chunks: Buffer[]): Uint8Array {
  return new Uint8Array(
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks, chunk("IEND", new Uint8Array())]),
  );
}

describe("PNG metadata inspection", () => {
  it("decodes compressed text and international metadata before scanning", async () => {
    const secret = "AKIA" + "A".repeat(16);
    const bytes = png(
      chunk("zTXt", Buffer.concat([Buffer.from("Comment\0\0"), deflateSync(secret)])),
      chunk("iTXt", Buffer.concat([Buffer.from("Comment\0\x01\0pl\0Opis\0"), deflateSync(secret)])),
    );
    expect(await pngMetadataTexts(bytes, new AbortController().signal)).toEqual([secret, secret]);
  });

  it("rejects animations, malformed metadata and excess decompression", async () => {
    const signal = new AbortController().signal;
    await expect(pngMetadataTexts(png(chunk("acTL", new Uint8Array(8))), signal)).rejects.toMatchObject({
      code: "ATTACHMENT_UNSUPPORTED",
    });
    await expect(pngMetadataTexts(png(chunk("zTXt", Buffer.from("broken"))), signal)).rejects.toThrow();
    await expect(
      pngMetadataTexts(
        png(chunk("zTXt", Buffer.concat([Buffer.from("Comment\0\0"), deflateSync("x".repeat(60_001))]))),
        signal,
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_LIMIT" });
  });
});
