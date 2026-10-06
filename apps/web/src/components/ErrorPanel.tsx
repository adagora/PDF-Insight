import type { RefObject } from "react";

import { messageFor, type UiError } from "../lib/messages";
import { Icon } from "./Icon";

type Props = {
  readonly error: UiError;
  readonly fileName: string | null;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
  readonly onReset: () => void;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
};

export function ErrorPanel({ error, fileName, canRetry, onRetry, onReset, headingRef }: Props) {
  const retry = canRetry;
  return (
    <section className="card error-panel" role="alert" aria-labelledby="error-title">
      <span className="error-icon">
        <Icon name="alert" size={28} />
      </span>
      <h2 id="error-title" ref={headingRef} tabIndex={-1}>
        Nie udało się przeanalizować dokumentu
      </h2>
      <p className="error-message">{messageFor(error)}</p>
      {fileName !== null && <p className="muted truncate">Plik: {fileName}</p>}
      {error.source === "api" && error.requestId !== null && (
        <p className="muted small">
          Identyfikator zgłoszenia: <code>{error.requestId}</code>
        </p>
      )}
      <div className="actions">
        {retry && (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <Icon name="refresh" size={18} /> Spróbuj ponownie
          </button>
        )}
        <button type="button" className={`btn ${retry ? "btn-secondary" : "btn-primary"}`} onClick={onReset}>
          <Icon name="upload" size={18} /> Wybierz inny plik
        </button>
      </div>
    </section>
  );
}
