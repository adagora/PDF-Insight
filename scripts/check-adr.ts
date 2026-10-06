import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "docs/adr";
const REQUIRED_SECTIONS = ["## Context", "## Considered options", "## Decision", "## Consequences", "## Confirmation"];
const STATUS =
  /^- \*\*Status:\*\* (Proposed|Accepted|Deprecated|Superseded by \[(\d{4})\]\((\d{4}-[a-z0-9-]+\.md)\))$/m;

const problems: string[] = [];
const index = readFileSync(join(DIR, "README.md"), "utf8");
const files = readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "README.md" && !f.startsWith("0000-"));
const seen = new Map<string, string>();

for (const file of files.sort()) {
  const match = /^(\d{4})-[a-z0-9-]+\.md$/.exec(file);
  if (match === null) {
    problems.push(`${file}: name must be NNNN-kebab-title.md`);
    continue;
  }
  const number = match[1] ?? "";
  const previous = seen.get(number);
  if (previous !== undefined) problems.push(`${file}: number ${number} already used by ${previous}`);
  seen.set(number, file);

  const text = readFileSync(join(DIR, file), "utf8");
  if (!text.startsWith(`# ${number}. `)) problems.push(`${file}: first line must be "# ${number}. <title>"`);
  const status = STATUS.exec(text);
  if (status === null) problems.push(`${file}: missing or invalid "- **Status:**" line`);
  const supersededBy = status?.[3];
  if (supersededBy !== undefined && !existsSync(join(DIR, supersededBy))) {
    problems.push(`${file}: superseded by missing ADR ${supersededBy}`);
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!text.includes(`\n${section}\n`)) problems.push(`${file}: missing section "${section}"`);
  }
  if (!index.includes(`(${file})`)) problems.push(`${file}: not listed in ${DIR}/README.md`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n\nADR policy: docs/adr/0001-record-architecture-decisions.md\n`);
  process.exit(1);
}
process.stdout.write(`${files.length} ADRs follow the policy.\n`);
