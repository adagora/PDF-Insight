import { useEffect, useState, type RefObject } from "react";

import type { InspectionProgress } from "../lib/inspection-model";
import { INSPECTION_MESSAGES_PL, inspectionProgressText } from "../lib/messages";
import { Icon } from "./Icon";

type Props = {
  readonly stage: "extracting" | "analyzing";
  readonly fileName: string;
  readonly progress: InspectionProgress | null;
  readonly ocrPages: number;
  readonly startedAt: number;
  readonly onCancel: () => void;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
};

const STEPS = [
  { key: "upload", label: "Wgranie PDF" },
  { key: "extracting", label: "Odczyt tekstu" },
  { key: "analyzing", label: "Analiza AI" },
  { key: "result", label: "Wynik" },
] as const;

function useElapsedSeconds(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function ProgressPanel({ stage, fileName, progress, ocrPages, startedAt, onCancel, headingRef }: Props) {
  const elapsed = useElapsedSeconds(startedAt);
  const activeIndex = stage === "extracting" ? 1 : 2;
  const percent = progress?.percent ?? null;

  return (
    <section className="card progress" aria-labelledby="progress-title" aria-busy="true">
      <div className="progress-head">
        <Icon name="file" size={22} />
        <div className="progress-file">
          <h2 id="progress-title" ref={headingRef} tabIndex={-1}>
            {stage === "extracting" ? INSPECTION_MESSAGES_PL.title : "Analizuję dokument…"}
          </h2>
          <p className="muted truncate" title={fileName}>
            {fileName}
          </p>
        </div>
        <span className="elapsed" aria-label={`Upłynęło ${elapsed} sekund`}>
          <Icon name="clock" size={16} /> {elapsed} s
        </span>
      </div>

      <ol className="stepper">
        {STEPS.map((step, index) => {
          const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
          return (
            <li key={step.key} className={`step is-${state}`} aria-current={state === "active" ? "step" : undefined}>
              <span className="step-dot">{state === "done" ? <Icon name="check" size={14} /> : index + 1}</span>
              <span className="step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>

      {stage === "extracting" ? (
        <div className="progress-detail">
          <div
            className={`bar${percent === null ? " is-indeterminate" : ""}`}
            role="progressbar"
            aria-label="Odczyt stron"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <span style={percent === null ? undefined : { width: `${percent}%` }} />
          </div>
          <p className="muted">{inspectionProgressText(progress)}</p>
        </div>
      ) : (
        <div className="progress-detail">
          <div className="bar is-indeterminate" role="progressbar" aria-label="Analiza AI">
            <span />
          </div>
          <p className="muted">
            Podsumowanie i dane strukturalne zwykle są gotowe w 10–20 s.
            {ocrPages > 0 ? ` Strony (${ocrPages}) zostały odczytane lokalnie z użyciem OCR.` : ""}
          </p>
        </div>
      )}

      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        <Icon name="close" size={18} /> Anuluj
      </button>
    </section>
  );
}
