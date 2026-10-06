import { LIMITS } from "@pdf-insight/shared";
import { describe, expect, it, vi } from "vitest";
import {
  createInspector,
  buildAnalysisRequest,
  type DecodedSource,
  type InspectionPorts,
} from "../src/lib/inspection-core";
import { createInspectionCache } from "../src/lib/inspection-cache";
import type { InspectionResult, InspectionProgress } from "../src/lib/inspection-model";

const SECRET = "AKIA" + "Z".repeat(16);
const bytes = (id: number) => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, id]);
const signal = () => new AbortController().signal;
const profile = { key: "test-v3", label: "test-v3" };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function source(overrides: Partial<DecodedSource> = {}): DecodedSource {
  return {
    pageCount: 1,
    imageCount: 0,
    decodedBytes: 1,
    attachments: [],
    metadata: [],
    findings: [],
    readOriginals: vi.fn(() => Promise.resolve({ metadata: [], findings: [], barcodes: 0 })),
    readPage: vi.fn(() =>
      Promise.resolve({
        text: "Contract amount 135 PLN",
        ocrText: "OCR amount 135 PLN",
        codes: [],
        notes: [],
        findings: [],
        metadata: [],
        barcodes: 0,
      }),
    ),
    close: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function cache() {
  return createInspectionCache<InspectionResult>({
    scope: "tab",
    maxEntries: 8,
    maxWeight: 1_000_000,
    ttlMs: 1_000,
    now: () => 0,
    weight: (value) => value.pages.reduce((sum, page) => sum + page.text.length, 0),
  });
}

function ports(nodes: ReadonlyMap<number, DecodedSource>): InspectionPorts {
  return {
    openPdf: vi.fn((input: Uint8Array) => {
      const node = nodes.get(input.at(-1) ?? -1);
      if (node === undefined) throw new Error("Missing test node");
      return Promise.resolve(node);
    }),
    openImage: vi.fn(() => Promise.reject(new Error("Unexpected image decoder"))),
  };
}

describe("inspection core without browser or IO", () => {
  it("rejects aggregate nested bytes before any OCR and closes admitted resources", async () => {
    const parent = source({
      attachments: [
        { name: "child.pdf", bytes: bytes(2) },
        { name: "sibling.pdf", bytes: bytes(3) },
      ],
    });
    const child = source({ attachments: [{ name: "grandchild.pdf", bytes: bytes(4) }] });
    const inspector = createInspector(
      ports(
        new Map([
          [1, parent],
          [2, child],
        ]),
      ),
      cache(),
      profile,
      { ...LIMITS, maxAttachmentBytes: 25 },
    );
    await expect(inspector.inspect(bytes(1), "root.pdf", () => undefined, signal())).rejects.toThrow(
      "INSPECTION_LIMIT",
    );
    expect(parent.readPage).not.toHaveBeenCalled();
    expect(child.readOriginals).not.toHaveBeenCalled();
    expect(parent.close).toHaveBeenCalledOnce();
    expect(child.close).toHaveBeenCalledOnce();
  });
  it("rejects global page and attachment counts before OCR", async () => {
    const parent = source({ attachments: [{ name: "child.pdf", bytes: bytes(2) }] });
    const child = source({ pageCount: 2 });
    const inspector = createInspector(
      ports(
        new Map([
          [1, parent],
          [2, child],
        ]),
      ),
      cache(),
      profile,
      { ...LIMITS, maxInspectionPages: 2 },
    );
    await expect(inspector.inspect(bytes(1), "root.pdf", () => undefined, signal())).rejects.toThrow(
      "INSPECTION_LIMIT",
    );
    expect(child.readPage).not.toHaveBeenCalled();
  });
  it("reuses completed child inspection across roots after admitting each whole tree", async () => {
    const attachment = { name: "child.pdf", bytes: bytes(3) };
    const first = source({ attachments: [attachment] });
    const second = source({ attachments: [attachment] });
    const child = source();
    const decoder = ports(
      new Map([
        [1, first],
        [2, second],
        [3, child],
      ]),
    );
    const inspector = createInspector(decoder, cache(), profile);
    await inspector.inspect(bytes(1), "first.pdf", () => undefined, signal());
    const progress: InspectionProgress[] = [];
    const result = await inspector.inspect(bytes(2), "second.pdf", (event) => progress.push(event), signal());
    expect(child.readPage).toHaveBeenCalledOnce();
    expect(decoder.openPdf).toHaveBeenCalledTimes(4);
    expect(result.inspection.attachments).toBe(1);
    expect(result.pageCount).toBe(2);
    expect(progress.at(-1)?.percent).toBe(100);
    const admitted = progress.filter((event) => event.percent !== null).map((event) => event.percent);
    expect(admitted).toEqual([...admitted].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
  it("does not use cached children to bypass a later root's admission limit", async () => {
    const attachment = { name: "child.pdf", bytes: bytes(3) };
    const first = source({ attachments: [attachment] });
    const second = source({ pageCount: 2, attachments: [attachment] });
    const child = source();
    const inspector = createInspector(
      ports(
        new Map([
          [1, first],
          [2, second],
          [3, child],
        ]),
      ),
      cache(),
      profile,
      { ...LIMITS, maxInspectionPages: 2 },
    );
    await inspector.inspect(bytes(1), "first.pdf", () => undefined, signal());
    await expect(inspector.inspect(bytes(2), "second.pdf", () => undefined, signal())).rejects.toThrow(
      "INSPECTION_LIMIT",
    );
    expect(second.readPage).not.toHaveBeenCalled();
    expect(child.readPage).toHaveBeenCalledOnce();
  });
  it("does not cache later child work from a root running before purge", async () => {
    const started = deferred<boolean>();
    const finish = deferred<boolean>();
    const attachment = { name: "child.pdf", bytes: bytes(3) };
    const readPage = source().readPage;
    const first = source({
      attachments: [attachment],
      readPage: async () => {
        started.resolve(true);
        await finish.promise;
        return readPage(1, 0);
      },
    });
    const second = source({ attachments: [attachment] });
    const child = source();
    const inspector = createInspector(
      ports(
        new Map([
          [1, first],
          [2, second],
          [3, child],
        ]),
      ),
      cache(),
      profile,
    );
    const pending = inspector.inspect(bytes(1), "first.pdf", () => undefined, signal());
    await started.promise;
    inspector.purge();
    finish.resolve(true);
    await pending;
    await inspector.inspect(bytes(2), "second.pdf", () => undefined, signal());
    expect(child.readPage).toHaveBeenCalledTimes(2);
  });
  it("reports all OCR-read pages and builds a redacted text-only request", async () => {
    const document = source({
      pageCount: 2,
      readPage: () =>
        Promise.resolve({
          text: `Text layer ${SECRET}`,
          ocrText: `OCR ${SECRET}`,
          codes: [],
          notes: [],
          findings: [],
          metadata: [],
          barcodes: 0,
        }),
    });
    const result = await createInspector(ports(new Map([[1, document]])), cache(), profile).inspect(
      bytes(1),
      `${SECRET}.pdf`,
      () => undefined,
      signal(),
    );
    const request = buildAnalysisRequest(`${SECRET}.pdf`, result);
    expect(result.ocrPages).toEqual([1, 2]);
    expect(request.fileName).toBe("dokument.pdf");
    expect(JSON.stringify(request)).not.toContain(SECRET);
    expect(request.pages.every((page) => page.source === "ocr")).toBe(true);
  });
});
