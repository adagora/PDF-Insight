import { z } from "zod";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
});

const InputSchema = z.object({ pixels: z.instanceof(ImageData) });

self.addEventListener("message", (event: MessageEvent) => {
  void (async () => {
    try {
      const { pixels } = InputSchema.parse(event.data);
      const results = await readBarcodes(pixels, {
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        maxNumberOfSymbols: 50,
      });
      self.postMessage({ ok: true, texts: results.filter((result) => result.isValid).map((result) => result.text) });
    } catch {
      self.postMessage({ ok: false });
    }
  })();
});
