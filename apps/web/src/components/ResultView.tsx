import { useId, useMemo, useState, type KeyboardEvent, type RefObject } from "react";

import type { AnalysisWarning, ValidatedAnalysis } from "@pdf-insight/shared";

import {
  DOCUMENT_TYPE_LABELS,
  downloadJson,
  formatAmount,
  formatDateTime,
  formatDuration,
  formatIsoDate,
  languageName,
} from "../lib/format";
import { Icon } from "./Icon";
import { JsonPreview } from "./JsonPreview";

type Props = {
  readonly result: ValidatedAnalysis;
  readonly origin: "fresh" | "history";
  readonly onNew: () => void;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
};

type Tab = "results" | "json";

function warningsByPath(warnings: readonly AnalysisWarning[]): Map<string, AnalysisWarning> {
  const map = new Map<string, AnalysisWarning>();
  for (const warning of warnings) if (warning.path !== undefined) map.set(warning.path, warning);
  return map;
}

function RowFlag({ warning }: { readonly warning: AnalysisWarning | undefined }) {
  if (warning === undefined) return null;
  const label = warning.code === "VALUE_FROM_SCAN" ? "ze skanu" : "brak w tekście";
  return (
    <span className={`flag flag-${warning.severity}`} title={warning.message}>
      <Icon name={warning.severity === "warning" ? "alert" : "info"} size={14} />
      {label}
      <span className="visually-hidden">: {warning.message}</span>
    </span>
  );
}

function PageRef({ page }: { readonly page: number | null | undefined }) {
  return page === null || page === undefined ? (
    <span className="muted">—</span>
  ) : (
    <span className="muted">s. {page}</span>
  );
}

function Warnings({ warnings }: { readonly warnings: readonly AnalysisWarning[] }) {
  const general = warnings.filter((w) => w.path === undefined);
  const flaggedItems = warnings.filter((w) => w.path !== undefined && w.severity === "warning").length;
  if (general.length === 0 && flaggedItems === 0) return null;
  return (
    <section className="card warnings" aria-labelledby="warnings-title">
      <h3 id="warnings-title" className="card-title">
        <Icon name="alert" size={18} /> Uwagi do analizy
      </h3>
      <ul className="warning-list">
        {general.map((w, i) => (
          <li key={`${w.code}-${i}`} className={`warning warning-${w.severity}`}>
            <Icon name={w.severity === "warning" ? "alert" : "info"} size={18} />
            <div>
              <p>
                {w.message}
                {w.page !== undefined && w.page !== null && <span className="muted"> (s. {w.page})</span>}
              </p>
              {w.excerpt !== undefined && <blockquote className="excerpt">„{w.excerpt}”</blockquote>}
            </div>
          </li>
        ))}
        {flaggedItems > 0 && (
          <li className="warning warning-warning">
            <Icon name="alert" size={18} />
            <p>
              Wartości oznaczone jako <strong>brak w tekście</strong> ({flaggedItems}) nie zostały znalezione w treści
              dokumentu — sprawdź je w oryginale.
            </p>
          </li>
        )}
      </ul>
    </section>
  );
}

function Chips({ items, empty }: { readonly items: readonly string[]; readonly empty: string }) {
  return items.length === 0 ? (
    <p className="muted">{empty}</p>
  ) : (
    <ul className="chips">
      {items.map((item) => (
        <li key={item} className="chip">
          {item}
        </li>
      ))}
    </ul>
  );
}

function ResultsBody({ result }: { readonly result: ValidatedAnalysis }) {
  const flags = useMemo(() => warningsByPath(result.warnings), [result.warnings]);
  const { entities, amounts, dates, keywords, keyPoints, meta } = result;

  return (
    <div className="results-grid">
      <div className="results-main">
        <section className="card summary" aria-labelledby="summary-title">
          <h3 id="summary-title" className="card-title">
            <Icon name="spark" size={18} /> Podsumowanie
          </h3>
          <p className="summary-text" lang={result.document.language}>
            {result.summary}
          </p>
        </section>

        <section className="card" aria-labelledby="keypoints-title">
          <h3 id="keypoints-title" className="card-title">
            Najważniejsze punkty
          </h3>
          <ul className="keypoints" lang={result.document.language}>
            {keyPoints.map((point) => (
              <li key={point}>
                <Icon name="check" size={16} />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="amounts-title">
          <h3 id="amounts-title" className="card-title">
            Kwoty <span className="count">{amounts.length}</span>
          </h3>
          {amounts.length === 0 ? (
            <p className="muted">Dokument nie zawiera kwot.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <caption className="visually-hidden">Kwoty znalezione w dokumencie</caption>
                <thead>
                  <tr>
                    <th scope="col">Kwota</th>
                    <th scope="col">Dotyczy</th>
                    <th scope="col">Strona</th>
                  </tr>
                </thead>
                <tbody lang={result.document.language}>
                  {amounts.map((amount, i) => (
                    <tr key={`${amount.value}-${amount.currency}-${i}`}>
                      <td data-label="Kwota" className="num">
                        <strong>{formatAmount(amount.value, amount.currency)}</strong>
                        <RowFlag warning={flags.get(`amounts[${i}]`)} />
                      </td>
                      <td data-label="Dotyczy">{amount.context}</td>
                      <td data-label="Strona">
                        <PageRef page={amount.page} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="dates-title">
          <h3 id="dates-title" className="card-title">
            Daty <span className="count">{dates.length}</span>
          </h3>
          {dates.length === 0 ? (
            <p className="muted">Dokument nie zawiera dat.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <caption className="visually-hidden">Daty znalezione w dokumencie</caption>
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Dotyczy</th>
                    <th scope="col">Strona</th>
                  </tr>
                </thead>
                <tbody lang={result.document.language}>
                  {[...dates.entries()]
                    .sort(([, a], [, b]) => a.date.localeCompare(b.date))
                    .map(([i, item]) => (
                      <tr key={`${item.date}-${i}`}>
                        <td data-label="Data" className="nowrap">
                          <time dateTime={item.date}>
                            <strong>{formatIsoDate(item.date)}</strong>
                          </time>
                          <RowFlag warning={flags.get(`dates[${i}]`)} />
                        </td>
                        <td data-label="Dotyczy">{item.context}</td>
                        <td data-label="Strona">
                          <PageRef page={item.page} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside className="results-side" aria-label="Szczegóły dokumentu">
        <Warnings warnings={result.warnings} />

        <section className="card" aria-labelledby="entities-title">
          <h3 id="entities-title" className="card-title">
            Podmioty
          </h3>
          <h4 className="subhead">Organizacje</h4>
          <Chips items={entities.organizations} empty="Brak organizacji." />
          <h4 className="subhead">Osoby</h4>
          <Chips items={entities.people} empty="Brak osób." />
        </section>

        <section className="card" aria-labelledby="keywords-title">
          <h3 id="keywords-title" className="card-title">
            Słowa kluczowe
          </h3>
          <Chips items={keywords} empty="Brak słów kluczowych." />
        </section>

        <section className="card meta" aria-labelledby="meta-title">
          <h3 id="meta-title" className="card-title">
            O analizie
          </h3>
          <dl className="meta-list">
            <dt>Model</dt>
            <dd>{meta.model}</dd>
            <dt>Czas analizy</dt>
            <dd>{formatDuration(meta.durationMs)}</dd>
            <dt>Wykonano</dt>
            <dd>{formatDateTime(meta.generatedAt)}</dd>
            {meta.chunks > 1 && (
              <>
                <dt>Fragmenty</dt>
                <dd>{meta.chunks}</dd>
              </>
            )}
            {meta.ocrPages.length > 0 && (
              <>
                <dt>Strony z OCR</dt>
                <dd>{meta.ocrPages.join(", ")}</dd>
              </>
            )}
          </dl>
        </section>
      </aside>
    </div>
  );
}

export function ResultView({ result, origin, onNew, headingRef }: Props) {
  const [tab, setTab] = useState<Tab>("results");
  const baseId = useId();
  const tabs: readonly { id: Tab; label: string }[] = [
    { id: "results", label: "Wyniki" },
    { id: "json", label: "JSON" },
  ];

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next: Tab =
      event.key === "Home" ? "results" : event.key === "End" ? "json" : tab === "results" ? "json" : "results";
    setTab(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  };

  const { document: doc } = result;

  return (
    <section className="result" aria-labelledby="result-title">
      <header className="result-header">
        <div className="result-heading">
          <p className="eyebrow">
            {origin === "history" ? "Z historii · " : ""}
            {DOCUMENT_TYPE_LABELS[doc.type]}
          </p>
          <h2 id="result-title" ref={headingRef} tabIndex={-1} lang={doc.language}>
            {doc.title ?? doc.fileName}
          </h2>
          <ul className="doc-facts">
            <li title={doc.fileName} className="truncate">
              <Icon name="file" size={16} /> {doc.fileName}
            </li>
            <li>{doc.pages === 1 ? "1 strona" : `${doc.pages} str.`}</li>
            <li>{languageName(doc.language)}</li>
            {doc.date !== null && (
              <li>
                <time dateTime={doc.date}>{formatIsoDate(doc.date)}</time>
              </li>
            )}
          </ul>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => downloadJson(result)}>
            <Icon name="download" size={18} /> Pobierz JSON
          </button>
          <button type="button" className="btn btn-secondary" onClick={onNew}>
            <Icon name="plus" size={18} /> Nowa analiza
          </button>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Widok wyniku">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`${baseId}-tab-${t.id}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKey}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id={`${baseId}-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="tabpanel"
        tabIndex={tab === "json" ? -1 : undefined}
      >
        {tab === "results" ? <ResultsBody result={result} /> : <JsonPreview result={result} />}
      </div>
    </section>
  );
}
