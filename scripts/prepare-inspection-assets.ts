import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const destination = resolve("apps/web/public/inspection");
mkdirSync(destination, { recursive: true });

const worker = resolve(dirname(require.resolve("tesseract.js")), "../dist/worker.min.js");
copyFileSync(worker, join(destination, "worker.min.js"));
const core = dirname(require.resolve("tesseract.js-core/package.json"));
for (const name of readdirSync(core)) {
  if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(name)) copyFileSync(join(core, name), join(destination, name));
}
for (const language of ["eng", "pol"]) {
  const source = dirname(require.resolve(`@tesseract.js-data/${language}/package.json`));
  copyFileSync(
    join(source, "4.0.0_best_int", `${language}.traineddata.gz`),
    join(destination, `${language}.traineddata.gz`),
  );
}
process.stdout.write("Local OCR worker, WASM and language assets prepared.\n");
