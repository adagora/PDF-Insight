import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { findSecrets } from "@pdf-insight/shared";

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz)$/i;
const SKIP = /(^|\/)(package-lock\.json|node_modules\/)/;
const scanHistory = process.argv.includes("--history");

function repoFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" });
  return out.split("\n").filter((f) => f.length > 0 && !BINARY.test(f) && !SKIP.test(f) && existsSync(f));
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : BINARY.test(path) ? [] : [path];
  });
}

function realKeyValues(): string[] {
  if (!existsSync(".env")) return [];
  return readFileSync(".env", "utf8")
    .split("\n")
    .map((line) => /^\s*[A-Z0-9_]*(KEY|TOKEN|SECRET)[A-Z0-9_]*\s*=\s*(.+?)\s*$/.exec(line)?.[2] ?? "")
    .map((value) => value.replace(/^["']|["']$/g, ""))
    .filter((value) => value.length >= 12);
}

const keys = realKeyValues();
const findings: string[] = [];

function scan(label: string, text: string): void {
  for (const match of findSecrets(text)) {
    const line = text.slice(0, match.index).split("\n").length;
    findings.push(`${label}:${line}  pattern ${match.kind}`);
  }
  for (const key of keys) {
    if (text.includes(key)) findings.push(`${label}  contains the real value of a key from .env`);
  }
}

const targets = [...repoFiles(), ...walk("apps/web/dist")];
for (const file of targets) scan(file, readFileSync(file, "utf8"));

if (scanHistory) {
  const log = execFileSync("git", ["log", "--all", "-p", "--no-color"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  scan("git history", log);
}

if (findings.length > 0) {
  process.stderr.write(`Possible secrets found (values not printed):\n${findings.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `No secrets in ${targets.length} files${scanHistory ? " or git history" : ""} (${keys.length} real key value(s) checked).\n`,
);
