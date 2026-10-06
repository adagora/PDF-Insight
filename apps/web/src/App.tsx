import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { requestAnalysis } from "./api/client";
import { ErrorPanel } from "./components/ErrorPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { Icon } from "./components/Icon";
import { ProgressPanel } from "./components/ProgressPanel";
import { ResultView } from "./components/ResultView";
import { UploadPanel } from "./components/UploadPanel";
import { validateFile } from "./lib/file-validation";
import { browserStorage, createHistory, type HistoryEntry } from "./lib/history";
import { CLIENT_ERROR_MESSAGES_PL, INSPECTION_MESSAGES_PL, workflowStatusText } from "./lib/messages";
import { extractPdf, purgeInspectionCache } from "./lib/pdf";
import { createWorkflow, workflowReducer, canRetry } from "./lib/workflow";

export function App() {
  const [phase, dispatch] = useReducer(workflowReducer<File>, { kind: "idle", inlineError: null });
  const history = useMemo(() => createHistory(browserStorage()), []);
  const [entries, setEntries] = useState<readonly HistoryEntry[]>(() => history.list());
  const [cacheNotice, setCacheNotice] = useState("");
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const storageAvailable = useMemo(() => browserStorage() !== null, []);

  useEffect(() => {
    if (phase.kind !== "idle") headingRef.current?.focus();
  }, [phase.kind]);

  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const workflow = useMemo(
    () =>
      createWorkflow<File>({
        validate: validateFile,
        inspect: extractPdf,
        analyze: requestAnalysis,
        save: (result) => setEntries(history.add(result)),
        now: Date.now,
        emit: dispatch,
      }),
    [history],
  );
  useEffect(() => () => workflow.stop(), [workflow]);
  const onFile = useCallback((file: File) => void workflow.run({ kind: "file", file }, file.name), [workflow]);
  const cancel = useCallback(() => workflow.cancel(), [workflow]);

  const clearInspection = () => {
    purgeInspectionCache();
    setCacheNotice(INSPECTION_MESSAGES_PL.cacheCleared);
  };

  const retry = useCallback(() => {
    if (phase.kind !== "error" || phase.retry === null) return;
    void workflow.run(phase.retry, phase.fileName ?? "dokument.pdf");
  }, [phase, workflow]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Przejdź do treści
      </a>
      <header className="app-header">
        <div className="container header-inner">
          <button type="button" className="brand" onClick={cancel} aria-label="PDF Insight — strona główna">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="file" size={20} />
            </span>
            <span className="brand-name">PDF Insight</span>
          </button>
          <p className="header-tagline">Podsumowanie i dane z PDF w kilka sekund</p>
        </div>
      </header>

      <main id="main" className="container main">
        <p className="visually-hidden" role="status" aria-live="polite">
          {workflowStatusText(phase)}
        </p>

        {phase.kind === "idle" && (
          <div className="home">
            <div className="hero">
              <h1>Zamień PDF w zwięzłe podsumowanie i uporządkowane dane</h1>
              <p className="lead">
                Wgraj umowę, fakturę, ofertę lub raport. Otrzymasz 3–5 zdań podsumowania, kluczowe punkty, podmioty,
                kwoty i daty — do pobrania jako JSON.
              </p>
            </div>
            <UploadPanel
              onFile={onFile}
              onMultipleFiles={() => dispatch({ type: "reset", inlineError: "MULTIPLE_FILES" })}
              inlineError={phase.inlineError === null ? null : CLIENT_ERROR_MESSAGES_PL[phase.inlineError]}
            />
            <div className="inspection-note">
              <p>{INSPECTION_MESSAGES_PL.cacheDescription}</p>
              <button type="button" className="btn btn-ghost" onClick={clearInspection}>
                {INSPECTION_MESSAGES_PL.clearCache}
              </button>
              <p role="status">{cacheNotice}</p>
            </div>
            <HistoryPanel
              entries={entries}
              available={storageAvailable}
              onOpen={(entry) => dispatch({ type: "result", result: entry.result, origin: "history" })}
              onRemove={(id) => setEntries(history.remove(id))}
              onClear={() => setEntries(history.clear())}
            />
          </div>
        )}

        {(phase.kind === "extracting" || phase.kind === "analyzing") && (
          <ProgressPanel
            stage={phase.kind}
            fileName={phase.fileName}
            progress={phase.kind === "extracting" ? phase.progress : null}
            ocrPages={phase.kind === "analyzing" ? phase.ocrPages : 0}
            startedAt={phase.startedAt}
            onCancel={cancel}
            headingRef={headingRef}
          />
        )}

        {phase.kind === "error" && (
          <ErrorPanel
            error={phase.error}
            fileName={phase.fileName}
            canRetry={canRetry(phase)}
            onRetry={retry}
            onReset={() => dispatch({ type: "reset" })}
            headingRef={headingRef}
          />
        )}

        {phase.kind === "result" && (
          <ResultView
            result={phase.result}
            origin={phase.origin}
            onNew={() => dispatch({ type: "reset" })}
            headingRef={headingRef}
          />
        )}
      </main>

      <footer className="app-footer">
        <div className="container footer-inner">
          <p>
            Wyniki generuje model AI i mogą zawierać błędy — weryfikuj je z oryginałem. Kwoty i daty są automatycznie
            sprawdzane z treścią dokumentu.
          </p>
        </div>
      </footer>
    </div>
  );
}
