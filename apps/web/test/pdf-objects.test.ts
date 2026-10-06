import { existsSync, readFileSync } from "node:fs";

import { PDFDocument, PDFHexString, PDFName, PDFString, PDFDict, PDFArray } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { inspectPdfObjects } from "../src/lib/pdf-object-inspection";

const SECRET = "AKIA" + "Z".repeat(16);

describe("PDF object inspection before forwarding", () => {
  it("inspects literal, hex, UTF-16 and compressed object strings without returning them", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.context.register(PDFString.of(SECRET));
    pdf.context.register(PDFHexString.fromText(SECRET));
    pdf.context.register(pdf.context.flateStream(`(${SECRET})<${Buffer.from(SECRET).toString("hex")}>`));
    const result = await inspectPdfObjects(await pdf.save());
    expect(result.findings.find((finding) => finding.kind === "aws-access-key-id")?.count).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("rejects uninspectable image filters and active content", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.context.register(
      pdf.context.stream(new Uint8Array([1, 2]), {
        Subtype: "Image",
        Width: 1,
        Height: 1,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "JBIG2Decode",
      }),
    );
    await expect(inspectPdfObjects(await pdf.save())).rejects.toThrow();
    const active = await PDFDocument.create();
    active.addPage();
    active.catalog.set(PDFName.of("JS"), PDFString.of("secret-bearing-script"));
    await expect(inspectPdfObjects(await active.save())).rejects.toMatchObject({ code: "ATTACHMENT_UNSUPPORTED" });
  });

  it("decodes original unpainted raster streams at original resolution", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.context.register(
      pdf.context.flateStream(new Uint8Array([255, 0, 0, 0, 255, 0]), {
        Subtype: "Image",
        Width: 2,
        Height: 1,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
      }),
    );
    const result = await inspectPdfObjects(await pdf.save());
    expect(result.images).toEqual([
      { kind: "pixels", width: 2, height: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]) },
    ]);
  });

  it("discovers associated and annotation attachments and deduplicates aliased streams", async () => {
    const child = await PDFDocument.create();
    child.addPage();
    const bytes = await child.save();
    const parent = await PDFDocument.create();
    parent.addPage();
    await parent.attach(bytes, "child.pdf");
    const pdf = await PDFDocument.load(await parent.save());
    const names = pdf.catalog
      .lookup(PDFName.of("Names"), PDFDict)
      .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
      .lookup(PDFName.of("Names"), PDFArray);
    const file = names.get(1);
    pdf.catalog.set(PDFName.of("AF"), pdf.context.obj([file]));
    const annotation = pdf.context.register(
      pdf.context.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [0, 0, 20, 20], FS: file }),
    );
    pdf.getPages()[0]?.node.set(PDFName.of("Annots"), pdf.context.obj([annotation]));
    pdf.catalog.delete(PDFName.of("Names"));
    const result = await inspectPdfObjects(await pdf.save());
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.name).toBe("child.pdf");
    expect(result.attachments[0]?.bytes).toEqual(bytes);
  });

  it("discovers orphan embedded streams and rejects external file specifications", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.context.register(
      pdf.context.flateStream(new TextEncoder().encode("%PDF-1.7\nembedded"), { Type: "EmbeddedFile" }),
    );
    expect((await inspectPdfObjects(await pdf.save())).attachments).toHaveLength(1);
    pdf.context.register(pdf.context.obj({ Type: "Filespec", F: PDFString.of("https://example.test/remote.pdf") }));
    await expect(inspectPdfObjects(await pdf.save())).rejects.toMatchObject({ code: "ATTACHMENT_UNSUPPORTED" });
  });

  it.each(["", "/F /AHx"])("decodes inline raster originals with %s encoding", async (filter) => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const prefix = new TextEncoder().encode(`q BI /W 1 /H 1 /CS /RGB /BPC 8 ${filter} ID `);
    const image = filter === "" ? new Uint8Array([255, 0, 0]) : new TextEncoder().encode("FF0000>");
    const suffix = new TextEncoder().encode(" EI Q");
    const content = new Uint8Array(prefix.length + image.length + suffix.length);
    content.set(prefix);
    content.set(image, prefix.length);
    content.set(suffix, prefix.length + image.length);
    page.node.addContentStream(pdf.context.register(pdf.context.flateStream(content)));
    const result = await inspectPdfObjects(await pdf.save());
    expect(result.images).toEqual([
      { kind: "pixels", width: 1, height: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255]) },
    ]);
  });

  it("does not mistake literal BI text for an image and blocks unsupported inline encodings", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    page.node.addContentStream(pdf.context.register(pdf.context.flateStream("BT (BI ID text EI) Tj ET")));
    expect((await inspectPdfObjects(await pdf.save())).images).toHaveLength(0);
    page.node.addContentStream(
      pdf.context.register(pdf.context.flateStream("BI /W 1 /H 1 /CS /RGB /BPC 8 /F /Fl ID opaque EI")),
    );
    await expect(inspectPdfObjects(await pdf.save())).rejects.toMatchObject({ code: "ATTACHMENT_UNSUPPORTED" });
  });

  it.skipIf(!existsSync("raw/Test_PDF_Insight_umowa_14-2026.pdf"))(
    "can inspect the supplied contract's objects and original scanned annex",
    async () => {
      const result = await inspectPdfObjects(new Uint8Array(readFileSync("raw/Test_PDF_Insight_umowa_14-2026.pdf")));
      expect(result.strings).toBeGreaterThan(0);
      expect(result.images.length).toBeGreaterThan(0);
    },
  );
});
