import { DOCUMENT_TYPE_LABELS, formatDateTime } from "../lib/format";
import type { HistoryEntry } from "../lib/history";
import { Icon } from "./Icon";

type Props = {
  readonly entries: readonly HistoryEntry[];
  readonly available: boolean;
  readonly onOpen: (entry: HistoryEntry) => void;
  readonly onRemove: (id: string) => void;
  readonly onClear: () => void;
};

export function HistoryPanel({ entries, available, onOpen, onRemove, onClear }: Props) {
  return (
    <section className="history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title" className="section-title">
          <Icon name="clock" size={18} /> Ostatnie analizy
        </h2>
        {entries.length > 0 && (
          <button type="button" className="btn btn-ghost btn-small" onClick={onClear}>
            Wyczyść historię
          </button>
        )}
      </div>
      {!available ? (
        <p className="muted empty">Historia jest niedostępna — przeglądarka blokuje zapis danych lokalnych.</p>
      ) : entries.length === 0 ? (
        <div className="empty">
          <p>Nie masz jeszcze żadnych analiz.</p>
          <p className="muted small">Wyniki zapisują się tylko w tej przeglądarce (ostatnie 10).</p>
        </div>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => (
            <li key={entry.id} className="history-item">
              <button type="button" className="history-open" onClick={() => onOpen(entry)}>
                <span className="history-type">{DOCUMENT_TYPE_LABELS[entry.result.document.type]}</span>
                <span className="history-name truncate">
                  {entry.result.document.title ?? entry.result.document.fileName}
                </span>
                <span className="muted small truncate">
                  {entry.result.document.fileName} · {formatDateTime(entry.savedAt)}
                </span>
              </button>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => onRemove(entry.id)}
                aria-label={`Usuń z historii: ${entry.result.document.fileName}`}
              >
                <Icon name="trash" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
