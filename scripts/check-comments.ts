import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import ts from "typescript";

const ALLOWED = [
  /^\/\/ SAFETY: \S/,
  /^\/\/ (eslint|oxlint)-disable-next-line \S+ -- \S/,
  /^\/\/ prettier-ignore$/,
  /^\/\/ @ts-expect-error — \S/,
];

const SOURCE = /\.(ts|tsx|js|mjs)$/;
const EXCLUDED = /^(tools|docs|node_modules|raw|markdown_extractions|\.brief-corpus)\/|\/dist\/|\/\.wrangler\//;

type Comment = {
  readonly file: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" });
  return out.split("\n").filter((file) => SOURCE.test(file) && !EXCLUDED.test(file));
}

function commentsIn(file: string, text: string): Comment[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const seen = new Map<number, Comment>();
  const collect = (ranges: readonly ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      const line = source.getLineAndCharacterOfPosition(range.pos).line + 1;
      seen.set(range.pos, { file, line, start: range.pos, end: range.end, text: text.slice(range.pos, range.end) });
    }
  };
  const visit = (node: ts.Node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  collect(ts.getLeadingCommentRanges(text, source.getEnd()));
  return [...seen.values()].sort((a, b) => a.start - b.start);
}

function isAllowed(comment: Comment): boolean {
  return ALLOWED.some((pattern) => pattern.test(comment.text));
}

function strip(text: string, comments: readonly Comment[]): string {
  let out = text;
  for (const comment of [...comments].reverse()) {
    const lineStart = out.lastIndexOf("\n", comment.start - 1) + 1;
    const nextBreak = out.indexOf("\n", comment.end);
    const lineEnd = nextBreak === -1 ? out.length : nextBreak;
    const before = out.slice(lineStart, comment.start);
    const after = out.slice(comment.end, lineEnd);
    const jsxWrapped = /\{\s*$/.test(before) && /^\s*\}/.test(after);
    if (jsxWrapped) {
      const open = out.lastIndexOf("{", comment.start);
      const close = out.indexOf("}", comment.end) + 1;
      out = out.slice(0, open) + out.slice(close);
    } else if (before.trim() === "" && after.trim() === "") {
      out = out.slice(0, lineStart) + out.slice(nextBreak === -1 ? lineEnd : lineEnd + 1);
    } else {
      out = out.slice(0, comment.start).replace(/[ \t]+$/, "") + out.slice(comment.end);
    }
  }
  return out.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

const fix = process.argv.includes("--fix");
const violations: Comment[] = [];
for (const file of trackedFiles()) {
  const text = readFileSync(file, "utf8");
  const forbidden = commentsIn(file, text).filter((comment) => !isAllowed(comment));
  if (forbidden.length === 0) continue;
  if (fix) writeFileSync(file, strip(text, forbidden));
  else violations.push(...forbidden);
}

if (violations.length > 0) {
  for (const v of violations) {
    process.stderr.write(`${v.file}:${v.line}  ${v.text.split("\n")[0]?.slice(0, 100) ?? ""}\n`);
  }
  process.stderr.write(
    `\n${violations.length} comment(s) found. AGENTS.md: no comments in code — put the "why" in an ADR or the commit message.\n` +
      "Allowed only: `// SAFETY: …` (type assertions), `// eslint-disable-next-line rule -- reason`, `// oxlint-disable-next-line rule -- reason`, `// prettier-ignore`, `// @ts-expect-error — reason`.\n",
  );
  process.exit(1);
}
process.stdout.write(fix ? "Comments stripped.\n" : "No forbidden comments.\n");
