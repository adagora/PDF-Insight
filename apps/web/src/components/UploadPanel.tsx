import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { Icon } from "./Icon";
import { INSPECTION_MESSAGES_PL } from "../lib/messages";

type Props = {
  readonly onFile: (file: File) => void;
  readonly onMultipleFiles: () => void;
  readonly inlineError: string | null;
};

export function UploadPanel({ onFile, onMultipleFiles, inlineError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();
  const errorId = useId();

  const pick = () => inputRef.current?.click();

  const accept = (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    const [first] = files;
    if (files.length > 1 || first === undefined) {
      onMultipleFiles();
      return;
    }
    onFile(first);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick();
    }
  };

  return (
    <section className="upload" aria-labelledby="upload-title">
      <div
        className={`dropzone${dragging ? " is-dragging" : ""}${inlineError === null ? "" : " has-error"}`}
        role="button"
        tabIndex={0}
        aria-describedby={inlineError === null ? hintId : `${hintId} ${errorId}`}
        onClick={pick}
        onKeyDown={onKeyDown}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <span className="dropzone-icon">
          <Icon name="upload" size={28} />
        </span>
        <h2 id="upload-title" className="dropzone-title">
          {dragging ? "Upuść plik, aby rozpocząć analizę" : "Przeciągnij tutaj plik PDF"}
        </h2>
        <p id={hintId} className="dropzone-hint">
          lub <span className="link-like">wybierz go z dysku</span> · tylko PDF, maks. 10 MB
        </p>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            accept(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
      </div>
      {inlineError !== null && (
        <p id={errorId} className="inline-error" role="alert">
          <Icon name="alert" size={18} />
          {inlineError}
        </p>
      )}
      <p className="privacy-note">
        <Icon name="shield" size={18} />
        <span>
          {INSPECTION_MESSAGES_PL.privacyBeforeProvider} <strong>Google Gemini (API AI)</strong>{" "}
          {INSPECTION_MESSAGES_PL.privacyAfterProvider}
        </span>
      </p>
    </section>
  );
}
