"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import { api, errorText } from "./api";
import {
  newCommand,
  sendCommand,
  type PendingCommand,
} from "./command-journal";
import type { PrivateConsultation } from "../contracts/private-consultation";
import styles from "./shared-file-library.module.css";

export type DocumentRequest = { id: string; question: string };

export function generatedDocumentPrompt(
  text: string,
  explicitlyAddressed: boolean,
) {
  const clean = text.trim().replace(/^@?(?:emme|miriam)\s*[,;:]?\s*/iu, "");
  if (!explicitlyAddressed && clean === text.trim()) return null;
  return /^(?:mi\s+)?(?:crea(?:mi)?|genera(?:mi)?|prepara(?:mi)?|scrivi(?:mi)?)\s+(?:(?:un|il|uno)\s+)?(?:documento|file markdown|file di testo)\b/iu.test(
    clean,
  )
    ? clean
    : null;
}

export function GeneratedDocument({
  workspace,
  actor,
  destination,
  initial,
  close,
  refresh,
}: {
  workspace: string;
  actor: string;
  destination?: string;
  initial?: DocumentRequest;
  close: () => void;
  refresh?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [result, setResult] = useState<PrivateConsultation | null>(null);
  const [error, setError] = useState(""),
    [running, setRunning] = useState(false),
    [shared, setShared] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    busy = useRef(false),
    alive = useRef(false);
  const request = useRef(initial),
    share = useRef<PendingCommand | null>(null);
  useEffect(() => {
    const node = dialog.current;
    alive.current = true;
    node?.showModal();
    return () => {
      alive.current = false;
      if (node?.open) node.close();
    };
  }, []);
  async function generate(value: DocumentRequest) {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setError("");
    try {
      const doc = await api<PrivateConsultation>(
        "/api/v1/workspaces/" + workspace + "/consultation",
        {
          action: "document",
          kind: "document",
          expectedActorId: actor,
          id: value.id,
          question: value.question,
        },
      );
      if (alive.current) {
        setResult(doc);
        refresh?.();
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      busy.current = false;
      if (alive.current) setRunning(false);
    }
  }
  useEffect(() => {
    if (!initial) return;
    const timer = setTimeout(() => void generate(initial), 0);
    return () => clearTimeout(timer);
    // The parent creates this request ID only after explicit submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id]);
  async function publish() {
    if (
      busy.current ||
      !result?.documentSourceId ||
      !result.documentWorkspaceId ||
      !destination
    )
      return;
    const cmd =
      share.current ??
      newCommand(actor, result.documentWorkspaceId, {
        type: "library.copy",
        sourceId: result.documentSourceId,
        destinationId: workspace,
      });
    busy.current = true;
    share.current = cmd;
    setRunning(true);
    setError("");
    try {
      await sendCommand(cmd);
      if (alive.current) {
        setShared(true);
        refresh?.();
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      busy.current = false;
      if (alive.current) setRunning(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.previewDialog}
      aria-label={uiText("Documento personale di Emme")}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
    >
      <header>
        <h2>
          {result
            ? uiText("Anteprima del documento")
            : uiText("Chiedi un documento a Emme")}
        </h2>
        <button type="button" className="quiet" onClick={close}>
          {uiText("Chiudi")}
        </button>
      </header>
      {result ? (
        <>
          <small>{uiText("Salvato nei Documenti personali · Solo tu")}</small>
          <pre>{result.answer}</pre>
          <footer>
            <a
              href={
                "/api/workspaces/" +
                result.documentWorkspaceId +
                "/sources/" +
                result.documentSourceId
              }
              download
            >
              {uiText("Scarica Markdown")}
            </a>
            {destination &&
              (shared ? (
                <span role="status">
                  {uiText("Condiviso in ")}
                  {destination}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={running}
                  onClick={() => void publish()}
                >
                  {uiText("Condividi in ")}
                  {destination}
                </button>
              ))}
          </footer>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = question.trim();
            if (!text) return;
            const next =
              request.current?.question === text
                ? request.current
                : { id: crypto.randomUUID(), question: text };
            request.current = next;
            void generate(next);
          }}
        >
          <label>
            {uiText("Che documento ti serve?")}
            <textarea
              value={question}
              disabled={running}
              maxLength={2000}
              required
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <p>
            {uiText(
              "Emme prepara un file Markdown nei tuoi Documenti personali. Puoi condividerlo dopo averlo letto.",
            )}
          </p>
          <button disabled={running || !question.trim()}>
            {running
              ? uiText("Emme sta scrivendo…")
              : error
                ? uiText("Riprova")
                : uiText("Prepara anteprima")}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
