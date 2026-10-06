import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { expect, test, type Page } from "@playwright/test";
import { AnalyzeRequestSchema, type AnalyzeRequest } from "@pdf-insight/shared";
import { PDFDocument, PDFHexString, PDFName, PDFDict, PDFArray } from "pdf-lib";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";

import { SAMPLE_PDF, analysisFixture, makePdf } from "./fixtures";
import { inspectPdfObjects } from "../apps/web/src/lib/pdf-object-inspection";

const SECRET = "AKIA" + "A".repeat(16);
const ANALYZE = "**/v1/analyze";
const require = createRequire(import.meta.url);

async function screenshotBytes(page: Page) {
  const data = await page.evaluate((secret) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1100;
    canvas.height = 450;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas unavailable");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.font = "40px monospace";
    context.fillText("Contract amount: 13 100 PLN", 50, 100);
    context.fillText(secret, 50, 220);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  }, SECRET);
  return Buffer.from(data, "base64");
}

async function barcodeBytes() {
  prepareZXingModule({
    overrides: { wasmBinary: await readFile(require.resolve("zxing-wasm/writer/zxing_writer.wasm")) },
  });
  const result = await writeBarcode(SECRET, { format: "QRCode", scale: 8 });
  if (result.image === null) throw new Error("Barcode fixture unavailable");
  return new Uint8Array(await result.image.arrayBuffer());
}

async function upload(page: Page, bytes: Uint8Array) {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "inspection.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("inspects screenshot OCR, metadata, object strings, QR and embedded attachments; caches completed inspection", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pdf = await PDFDocument.create();
  pdf.setTitle(SECRET);
  pdf.context.register(PDFHexString.fromText(SECRET));
  const picture = await pdf.embedPng(await screenshotBytes(page));
  pdf.addPage([1100, 450]).drawImage(picture, { x: 0, y: 0, width: 1100, height: 450 });
  await pdf.attach(await barcodeBytes(), "barcode.png", { mimeType: "image/png" });
  await pdf.attach(new TextEncoder().encode(`Attachment amount 135 PLN. ${SECRET}`), "notes.txt", {
    mimeType: "text/plain",
  });
  const bytes = await pdf.save();
  const requests: AnalyzeRequest[] = [];
  await page.route(ANALYZE, async (route) => {
    requests.push(AnalyzeRequestSchema.parse(route.request().postDataJSON()));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analysisFixture()) });
  });
  await upload(page, bytes);
  await expect(page.getByRole("heading", { level: 2, name: "Umowa serwisowa nr 7/2026" })).toBeVisible({
    timeout: 100_000,
  });
  const first = requests[0];
  expect(first).toBeDefined();
  expect(JSON.stringify(first)).not.toContain(SECRET);
  expect(JSON.stringify(first)).not.toContain('"image"');
  expect(first?.pages.some((item) => item.text.includes("[REDACTED:aws-access-key-id]"))).toBe(true);
  expect(first?.pages.some((item) => item.text.includes("135 PLN"))).toBe(true);
  expect(first?.inspection?.images).toBeGreaterThanOrEqual(2);
  expect(first?.inspection?.attachments).toBe(2);
  expect(first?.inspection?.barcodes).toBeGreaterThanOrEqual(1);
  expect(first?.inspection?.cacheHit).toBe(false);
  await page.getByRole("button", { name: "Nowa analiza" }).click();
  await upload(page, bytes);
  await expect(page.getByRole("heading", { level: 2, name: "Umowa serwisowa nr 7/2026" })).toBeVisible();
  expect(requests[1]?.inspection?.cacheHit).toBe(true);
  expect(requests[1]?.pages).toEqual(first?.pages);
  const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(stored).not.toContain(SECRET);
  expect(stored).not.toContain("Attachment amount");
  await page.getByRole("button", { name: "Nowa analiza" }).click();
  await page.getByRole("button", { name: "Wyczyść pamięć kontroli" }).click();
  await expect(page.getByText("Pamięć kontroli została wyczyszczona.")).toBeVisible();
  await upload(page, bytes);
  await expect(page.getByRole("heading", { level: 2, name: "Umowa serwisowa nr 7/2026" })).toBeVisible({
    timeout: 100_000,
  });
  expect(requests[2]?.inspection?.cacheHit).toBe(false);
});

test("inspects unpainted original image objects", async ({ page }) => {
  test.setTimeout(120_000);
  const pdf = await PDFDocument.load(SAMPLE_PDF);
  await pdf.embedPng(await screenshotBytes(page));
  const sent: AnalyzeRequest[] = [];
  await page.route(ANALYZE, async (route) => {
    sent.push(AnalyzeRequestSchema.parse(route.request().postDataJSON()));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analysisFixture()) });
  });
  await upload(page, await pdf.save());
  await expect(page.getByRole("heading", { level: 2, name: "Umowa serwisowa nr 7/2026" })).toBeVisible({
    timeout: 100_000,
  });
  expect(sent[0]?.inspection?.images).toBe(1);
  expect(sent[0]?.inspection?.redactions.some((finding) => finding.kind === "aws-access-key-id")).toBe(true);
  expect(JSON.stringify(sent)).not.toContain(SECRET);
});

test("unsupported embedded attachment blocks the whole request before API", async ({ page }) => {
  const pdf = await PDFDocument.load(SAMPLE_PDF);
  await pdf.attach(new Uint8Array([1, 2, 3]), "opaque.bin", { mimeType: "application/octet-stream" });
  let calls = 0;
  await page.route(ANALYZE, (route) => {
    calls += 1;
    return route.abort();
  });
  await upload(page, await pdf.save());
  await expect(page.locator(".error-message")).toContainText("nieobsługiwany załącznik", { timeout: 50_000 });
  expect(calls).toBe(0);
});

test("corrupt decoding blocks the whole request before API", async ({ page }) => {
  let calls = 0;
  await page.route(ANALYZE, (route) => {
    calls += 1;
    return route.abort();
  });
  await upload(page, new TextEncoder().encode("%PDF-1.7\ninvalid"));
  await expect(page.locator(".error-message")).toContainText("Żadna treść nie została wysłana do AI");
  expect(calls).toBe(0);
});

test("nested PDF attachments are inspected and excess depth blocks the whole request", async ({ page }) => {
  const requests: AnalyzeRequest[] = [];
  await page.route(ANALYZE, async (route) => {
    requests.push(AnalyzeRequestSchema.parse(route.request().postDataJSON()));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analysisFixture()) });
  });
  let bytes: Uint8Array = new Uint8Array(makePdf([[`Nested amount 135 PLN. ${SECRET}`]]));
  for (let depth = 0; depth < 2; depth += 1) {
    const parent = await PDFDocument.load(SAMPLE_PDF);
    await parent.attach(bytes, "nested.pdf", { mimeType: "application/pdf" });
    bytes = await parent.save();
  }
  await upload(page, bytes);
  await expect(page.getByRole("heading", { level: 2, name: "Umowa serwisowa nr 7/2026" })).toBeVisible({
    timeout: 50_000,
  });
  expect(requests[0]?.inspection?.attachments).toBe(2);
  expect(requests[0]?.pages.some((item) => item.text.includes("Nested amount 135 PLN"))).toBe(true);
  expect(JSON.stringify(requests[0])).not.toContain(SECRET);
  await page.getByRole("button", { name: "Nowa analiza" }).click();
  const tooDeep = await PDFDocument.load(SAMPLE_PDF);
  await tooDeep.attach(bytes, "nested.pdf", { mimeType: "application/pdf" });
  await upload(page, await tooDeep.save());
  await expect(page.locator(".error-message")).toContainText("przekracza limit kontroli", { timeout: 50_000 });
  expect(requests).toHaveLength(1);
});

for (const location of ["associated", "annotation"] as const) {
  test(`recursively inspects ${location}-only PDF attachments`, async ({ page }) => {
    const parent = await PDFDocument.load(SAMPLE_PDF);
    await parent.attach(makePdf([[`Associated amount 135 PLN. ${SECRET}`]]), "associated.pdf");
    const pdf = await PDFDocument.load(await parent.save());
    const names = pdf.catalog
      .lookup(PDFName.of("Names"), PDFDict)
      .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
      .lookup(PDFName.of("Names"), PDFArray);
    const file = names.get(1);
    if (location === "associated") pdf.catalog.set(PDFName.of("AF"), pdf.context.obj([file]));
    else {
      const annotation = pdf.context.register(
        pdf.context.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [0, 0, 20, 20], FS: file }),
      );
      pdf.getPages()[0]?.node.set(PDFName.of("Annots"), pdf.context.obj([annotation]));
    }
    pdf.catalog.delete(PDFName.of("Names"));
    const requests: AnalyzeRequest[] = [];
    await page.route(ANALYZE, async (route) => {
      requests.push(AnalyzeRequestSchema.parse(route.request().postDataJSON()));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analysisFixture()) });
    });
    await upload(page, await pdf.save());
    await expect(page.locator(".result")).toBeVisible({ timeout: 50_000 });
    expect(requests[0]?.inspection?.attachments).toBe(1);
    expect(requests[0]?.pages.some((item) => item.text.includes("Associated amount 135 PLN"))).toBe(true);
    expect(JSON.stringify(requests)).not.toContain(SECRET);
  });
}

test("inspects an inline image at original resolution when its rendered size is unreadable", async ({ page }, info) => {
  test.setTimeout(120_000);
  const png = await screenshotBytes(page);
  const data = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas unavailable");
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let at = 0; at < canvas.width * canvas.height; at += 1) {
      rgb[at * 3] = rgba[at * 4] ?? 0;
      rgb[at * 3 + 1] = rgba[at * 4 + 1] ?? 0;
      rgb[at * 3 + 2] = rgba[at * 4 + 2] ?? 0;
    }
    let binary = "";
    for (let at = 0; at < rgb.length; at += 16_384) binary += String.fromCharCode(...rgb.subarray(at, at + 16_384));
    return btoa(binary);
  }, png.toString("base64"));
  const pdf = await PDFDocument.load(SAMPLE_PDF);
  const content = Buffer.concat([
    Buffer.from("q 5 0 0 2 10 10 cm BI /W 1100 /H 450 /CS /RGB /BPC 8 ID "),
    Buffer.from(data, "base64"),
    Buffer.from(" EI Q"),
  ]);
  pdf.getPages()[0]?.node.addContentStream(pdf.context.register(pdf.context.flateStream(content)));
  const requests: AnalyzeRequest[] = [];
  await page.route(ANALYZE, async (route) => {
    requests.push(AnalyzeRequestSchema.parse(route.request().postDataJSON()));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analysisFixture()) });
  });
  const bytes = await pdf.save();
  const fixturePath = info.outputPath("inline-image-fixture.pdf");
  await writeFile(fixturePath, bytes);
  await info.attach("inline-image-fixture", { path: fixturePath, contentType: "application/pdf" });
  expect((await inspectPdfObjects(bytes)).images).toHaveLength(1);
  await upload(page, bytes);
  await expect(page.locator(".result")).toBeVisible({ timeout: 90_000 });
  expect(requests[0]?.inspection?.images).toBe(1);
  expect(requests[0]?.inspection?.redactions.some((item) => item.kind === "aws-access-key-id")).toBe(true);
  expect(JSON.stringify(requests)).not.toContain(SECRET);
  expect(requests[0]?.pages.every((item) => item.source === "ocr")).toBe(true);
});

test("unsupported inline encoding blocks the whole request", async ({ page }) => {
  const pdf = await PDFDocument.load(SAMPLE_PDF);
  pdf
    .getPages()[0]
    ?.node.addContentStream(
      pdf.context.register(pdf.context.flateStream("BI /W 1 /H 1 /CS /RGB /BPC 8 /F /Fl ID opaque EI")),
    );
  let calls = 0;
  await page.route(ANALYZE, (route) => {
    calls += 1;
    return route.abort();
  });
  await upload(page, await pdf.save());
  await expect(page.locator(".error-message")).toContainText("nieobsługiwany załącznik", { timeout: 30_000 });
  expect(calls).toBe(0);
});

test("whole-tree attachment count blocks forwarding before OCR", async ({ page }) => {
  const root = await PDFDocument.load(SAMPLE_PDF);
  for (let sibling = 0; sibling < 2; sibling += 1) {
    const child = await PDFDocument.load(SAMPLE_PDF);
    for (let item = 0; item < 5; item += 1)
      await child.attach(new TextEncoder().encode(`Note ${item}`), `note-${item}.txt`);
    await root.attach(await child.save(), `child-${sibling}.pdf`);
  }
  let calls = 0;
  await page.route(ANALYZE, (route) => {
    calls += 1;
    return route.abort();
  });
  await upload(page, await root.save());
  await expect(page.locator(".error-message")).toContainText("przekracza limit kontroli", { timeout: 30_000 });
  expect(calls).toBe(0);
});
