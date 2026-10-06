import { useMemo, useState } from "react";

import type { ValidatedAnalysis } from "@pdf-insight/shared";

import { toExportJson } from "../lib/format";
import { highlightJson } from "../lib/json-highlight";
import { Icon } from "./Icon";

export function JsonPreview({ result }: { readonly result: ValidatedAnalysis }) {
  const json = useMemo(() => toExportJson(result), [result]);
  const highlighted = useMemo(() => highlightJson(json), [json]);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    window.setTimeout(() => setCopied("idle"), 2_000);
  };

  return (
    <div className="json-preview">
      <div className="json-toolbar">
        <span className="muted small">{json.length.toLocaleString("pl-PL")} znaków · zgodny ze schematem wyniku</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy()}>
          <Icon name={copied === "ok" ? "check" : "copy"} size={16} />
          {copied === "ok" ? "Skopiowano" : copied === "fail" ? "Nie udało się skopiować" : "Kopiuj"}
        </button>
      </div>
      <pre className="json-code" tabIndex={0} aria-label="Podgląd JSON wyniku">
        <code>{highlighted}</code>
      </pre>
      <span className="visually-hidden" aria-live="polite">
        {copied === "ok" ? "Skopiowano JSON do schowka" : ""}
      </span>
    </div>
  );
}
