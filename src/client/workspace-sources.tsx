"use client";
import { useUiLanguage } from "./ui-language";

import Image from "next/image";
import { isSharedPhoto, sharedFileType } from "./shared-file-library";
import { FileVisibilityButton } from "./file-visibility-button";
import { WorkspaceIcon } from "./workspace-icon";
import { ProductHelp } from "./product-help";
import { humanCallActive } from "./call-audio-focus";
import { useState, useRef, useEffect } from "react";
import { sendCommand } from "./command-journal";
import {
  acceptedFiles,
  createFileUploadCommand,
  optionalMediaReading,
  type FileUploadRequest,
} from "./file-upload";
import type { Snapshot } from "./types";
import type { Command } from "@/contracts/commands";

import { researchStatusLabels as statuses } from "../shared/workspace-labels";
export function WorkspaceSources({
  state,
  actor,
  command,
  action,
  reload,
  busy,
  openSource,
  uploadRequest,
  researchRequest,
}: {
  state: Snapshot;
  actor: string;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  reload: () => Promise<void>;
  busy: boolean;
  openSource: (id: string) => void;
  /** A new request opens the file form, without triggering the OS picker. */
  uploadRequest?: number;
  researchRequest?: number;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [questionLink, setQuestionLink] = useState("");
  const [queryText, setQueryText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const previousUpload = useRef<{
    file: File;
    request: FileUploadRequest;
  } | null>(null);
  const uploading = useRef(false);
  const [allowModelProcessing, setAllowModelProcessing] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    recordStream = useRef<MediaStream | null>(null);
  const captureGeneration = useRef({ value: 0 });
  useEffect(() => {
    const capture = captureGeneration.current;
    const hidden = () => {
      if (!document.hidden) return;
      capture.value++;
      if (recorder.current?.state === "recording") recorder.current.stop();
      recordStream.current?.getTracks().forEach((t) => t.stop());
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      capture.value++;
      document.removeEventListener("visibilitychange", hidden);
      const r = recorder.current;
      if (r) {
        r.ondataavailable = null;
        r.onstop = null;
        r.onerror = null;
        if (r.state !== "inactive") r.stop();
      }
      recordStream.current?.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      recordStream.current = null;
    };
  }, [actor, state.workspace.id]);
  const needsModel = !!selectedFile && optionalMediaReading(selectedFile.name);
  const [previewId, setPreviewId] = useState<{
    id: string;
    version: number | undefined;
  }>();
  const preview = state.sources.find(
    (item) =>
      item.id === previewId?.id &&
      item.visibility_version === previewId.version &&
      !item.withdrawn &&
      isSharedPhoto(item.media_type),
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (preview && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [preview]);
  const processingLabels: Record<string, string> = {
    queued: "Lettura in attesa",
    processing: "Lettura in corso",
    ready: "Contenuto estratto",
    needs_configuration: "Servizio di lettura da collegare",
    needs_input: "Serve un chiarimento o un formato leggibile",
    failed: "Lettura non riuscita",
  };
  const name = (id: string) =>
    state.members.find((m) => m.user_id === id)?.name ?? "Partecipante";
  const mayContribute = state.members.some(
    (m) => m.user_id === actor && m.active && m.contributes,
  );
  const uploadDetails = useRef<HTMLDetailsElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const researchDetails = useRef<HTMLDetailsElement>(null);
  const researchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if ((!uploadRequest && !researchRequest) || !mayContribute) return;
    const details = researchRequest
      ? researchDetails.current
      : uploadDetails.current;
    const field = researchRequest ? researchInput.current : uploadInput.current;
    if (!details || !field) return;
    details.open = true;
    // WorkspaceLayer focuses its heading when it opens. This explicit shortcut
    // then moves focus to the requested form without submitting it.
    const frame = requestAnimationFrame(() => field.focus());
    return () => cancelAnimationFrame(frame);
  }, [uploadRequest, researchRequest, mayContribute]);
  return (
    <section
      className="card source-work"
      aria-label={uiText("Fonti e ricerche")}
    >
      <h2 className="sr-only">{uiText("Fonti e ricerche")}</h2>
      {mayContribute && (
        <div className="source-forms">
          <details ref={uploadDetails}>
            <summary>{uiText("Carica un file")}</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const file = selectedFile;
                void action(async () => {
                  if (!file || uploading.current) return;
                  uploading.current = true;
                  try {
                    const prior = previousUpload.current;
                    const request =
                      prior?.file === file &&
                      prior.request.actor === actor &&
                      prior.request.workspace === state.workspace.id &&
                      !!prior.request.command.allowModelProcessing ===
                        allowModelProcessing
                        ? prior.request
                        : await createFileUploadCommand(
                            actor,
                            state.workspace.id,
                            file,
                            {
                              allowModelProcessing,
                            },
                          );
                    previousUpload.current = { file, request };
                    await sendCommand(request);
                    previousUpload.current = null;
                  } finally {
                    uploading.current = false;
                  }
                  form.reset();
                  setSelectedFile(null);
                  setAllowModelProcessing(false);
                  await reload();
                });
              }}
            >
              <label>
                {uiText("Documento, immagine o messaggio vocale")}
                <input
                  ref={uploadInput}
                  name="document"
                  type="file"
                  accept={acceptedFiles}
                  onChange={(e) => {
                    setSelectedFile(e.target.files?.[0] ?? null);
                    setAllowModelProcessing(false);
                  }}
                  disabled={busy}
                />
              </label>
              <p className="hint">
                {uiText(
                  "Fino a 8 MiB per file e 200.000 caratteri di testo estratto. RIMIAM legge PDF e DOCX sul proprio server. Tutti i membri possono accedere al file, anche quelli che entreranno in futuro.",
                )}
              </p>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    if (recording) {
                      recorder.current?.stop();
                      return;
                    }
                    if (
                      !navigator.mediaDevices?.getUserMedia ||
                      typeof MediaRecorder === "undefined"
                    )
                      throw new Error("VOICE_RECORDING_UNAVAILABLE");
                    window.speechSynthesis?.cancel();
                    const generation = captureGeneration.current.value;
                    if (humanCallActive())
                      throw new Error(
                        "Termina la chiamata prima di registrare una nota.",
                      );
                    const stream = await navigator.mediaDevices.getUserMedia({
                      audio: true,
                    });
                    if (
                      generation !== captureGeneration.current.value ||
                      document.hidden
                    ) {
                      stream.getTracks().forEach((t) => t.stop());
                      return;
                    }
                    recordStream.current = stream;
                    const mime = MediaRecorder.isTypeSupported("audio/webm")
                      ? "audio/webm"
                      : MediaRecorder.isTypeSupported("audio/mp4")
                        ? "audio/mp4"
                        : "";
                    try {
                      const r = new MediaRecorder(
                          stream,
                          mime ? { mimeType: mime } : undefined,
                        ),
                        chunks: Blob[] = [];
                      recorder.current = r;
                      let size = 0,
                        failed = false;
                      const cleanup = () => {
                        stream.getTracks().forEach((t) => t.stop());
                        recordStream.current = null;
                        recorder.current = null;
                        setRecording(false);
                      };
                      r.ondataavailable = (e) => {
                        if (e.data.size) {
                          chunks.push(e.data);
                          size += e.data.size;
                          if (size > 8388608 && r.state !== "inactive")
                            r.stop();
                        }
                      };
                      r.onerror = () => {
                        failed = true;
                        cleanup();
                        void action(async () => {
                          throw new Error("VOICE_RECORDING_FAILED");
                        });
                      };
                      r.onstop = () => {
                        cleanup();
                        if (failed) return;
                        if (size > 8388608) {
                          void action(async () => {
                            throw new Error("DOCUMENT_TOO_LARGE");
                          });
                          return;
                        }
                        const type = r.mimeType || mime;
                        setSelectedFile(
                          new File(
                            chunks,
                            `messaggio-vocale.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`,
                            { type },
                          ),
                        );
                        setAllowModelProcessing(false);
                      };
                      r.start(1000);
                      setRecording(true);
                    } catch (error) {
                      stream.getTracks().forEach((t) => t.stop());
                      recordStream.current = null;
                      recorder.current = null;
                      throw error;
                    }
                  })
                }
              >
                {recording
                  ? uiText("Termina registrazione")
                  : uiText("Registra un messaggio vocale")}
              </button>
              {recording && (
                <p role="status">
                  {uiText(
                    "Registrazione in corso. Il messaggio sarà condiviso solo quando lo invii.",
                  )}
                </p>
              )}
              {selectedFile && (
                <p className="hint">
                  {uiText("Selezionato: ")}
                  {selectedFile.name}
                </p>
              )}
              {needsModel && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={allowModelProcessing}
                    onChange={(e) => setAllowModelProcessing(e.target.checked)}
                  />
                  {uiText(
                    "Consento l’invio di questa immagine o registrazione al servizio AI configurato per leggerla. L’originale rimane nello spazio.",
                  )}
                </label>
              )}

              <button disabled={busy || recording || !selectedFile}>
                {uiText("Condividi documento")}
              </button>
            </form>
          </details>
          <details ref={researchDetails}>
            <summary>{uiText("Cerca sul web")}</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const query = String(new FormData(form).get("query"));
                void action(async () => {
                  await command({
                    type: "research.request",
                    query,
                    discloseQuery: true,
                    ...(questionLink
                      ? {
                          questionId: questionLink.split(":")[0],
                          questionVersion: Number(questionLink.split(":")[1]),
                        }
                      : {}),
                  });
                  form.reset();
                });
              }}
            >
              {state.questions.length > 0 && (
                <label>
                  {uiText("Domanda collegata")}
                  <select
                    value={questionLink}
                    onChange={(e) => {
                      setQuestionLink(e.target.value);
                      const q = state.questions.find(
                        (q) => `${q.id}:${q.version}` === e.target.value,
                      );
                      if (q) setQueryText(q.content.slice(0, 500));
                    }}
                  >
                    <option value="">{uiText("Ricerca indipendente")}</option>
                    {state.questions
                      .filter((q) => q.status === "open")
                      .map((q) => (
                        <option key={q.id} value={`${q.id}:${q.version}`}>
                          {q.content}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                {uiText("Che cosa serve sapere?")}
                <input
                  ref={researchInput}
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  name="query"
                  maxLength={500}
                  required
                  placeholder={uiText(
                    "Come validare RIMIAM con i primi utenti beta",
                  )}
                />
              </label>
              <label className="check">
                <input type="checkbox" required />
                {uiText(
                  "Autorizzo l’invio del solo testo della ricerca al servizio esterno. Non includo dati che non posso condividere.",
                )}
              </label>
              <button disabled={busy}>{uiText("Avvia ricerca")}</button>
            </form>
          </details>
        </div>
      )}
      {!state.research.length && !state.sources.length && (
        <p className="hint">
          {uiText(
            "Qui ritroverai i materiali condivisi e i risultati delle ricerche.",
          )}
        </p>
      )}
      {state.research.map((work) => (
        <article
          key={work.id}
          className="source-work-item"
          aria-label={uiText("Ricerca: {0}", String(work.query))}
        >
          <h3>{work.query}</h3>
          <p>
            {uiText(statuses[work.status] ?? "") || work.status}
            {uiText(" · richiesta di")} {name(work.requested_by)}
          </p>
          {work.status === "needs_configuration" && (
            <p className="hint">
              {uiText(
                "Il servizio di ricerca non è ancora collegato. La richiesta è conservata; puoi continuare a lavorare nello spazio.",
              )}
            </p>
          )}
          {work.status === "failed" && (
            <p className="hint">
              {uiText(
                "Nessun risultato è stato accettato. Puoi riprovare quando il servizio è disponibile.",
              )}
            </p>
          )}
          {work.requested_by === actor && mayContribute && (
            <div className="row">
              {["failed", "needs_configuration"].includes(work.status) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await command({
                        type: "research.retry",
                        workId: work.id,
                      });
                    })
                  }
                >
                  {uiText("Riprova ricerca")}
                </button>
              )}
              {["queued", "running", "needs_configuration", "failed"].includes(
                work.status,
              ) && (
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await command({
                        type: "research.cancel",
                        workId: work.id,
                      });
                    })
                  }
                >
                  {uiText("Interrompi ricerca")}
                </button>
              )}
            </div>
          )}
          <details>
            <summary>{uiText("Perché e cronologia")}</summary>
            <button
              type="button"
              className="quiet source-link"
              onClick={() => openSource(work.request_source_id)}
            >
              {uiText("Richiesta originale")}
            </button>
            <ul>
              {state.researchEvents
                .filter((e) => e.work_id === work.id)
                .map((e, i) => (
                  <li key={i}>
                    {new Date(e.created_at).toLocaleString(uiLocale)} ·{" "}
                    {uiText(statuses[e.status] ?? "") || e.status}
                  </li>
                ))}
            </ul>
          </details>
        </article>
      ))}
      {state.sources
        .filter((source) => !source.withdrawn)
        .map((source) => (
          <article
            key={source.id}
            id={`source-${source.id}`}
            className="source-work-item"
          >
            <div className="source-row-heading">
              {isSharedPhoto(source.media_type) ? (
                <button
                  className="source-thumb"
                  type="button"
                  aria-label={uiText(
                    "Apri anteprima di {0}",
                    String(source.title),
                  )}
                  onClick={() =>
                    setPreviewId({
                      id: source.id,
                      version: source.visibility_version,
                    })
                  }
                >
                  <Image
                    unoptimized
                    loading="lazy"
                    width={64}
                    height={64}
                    src={`/api/workspaces/${state.workspace.id}/sources/${source.id}?preview=1`}
                    alt=""
                  />
                </button>
              ) : (
                <WorkspaceIcon name="files" />
              )}
              <div>
                <h3>{source.title}</h3>
                <small>
                  {source.kind === "document"
                    ? uiText(sharedFileType(source.media_type, source.title))
                    : uiText("Fonte web")}{" "}
                  · {name(source.contributed_by)}
                </small>
              </div>
            </div>
            {source.processing_status && (
              <p className="hint" role="status">
                {source.processing_error === "MEDIA_DISCLOSURE_REQUIRED"
                  ? uiText("Lettura con AI non autorizzata.")
                  : uiText(processingLabels[source.processing_status] ?? "") ||
                    uiText("Stato della lettura da verificare.")}
              </p>
            )}
            <div className="source-file-actions">
              {mayContribute &&
                source.processing_status &&
                ["failed", "needs_input", "needs_configuration"].includes(
                  source.processing_status,
                ) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const media =
                          source.media_type?.startsWith("image/") ||
                          source.media_type?.startsWith("audio/");
                        if (
                          media &&
                          !window.confirm(
                            uiText(
                              "Inviare questo file al servizio AI configurato per leggerne il contenuto?",
                            ),
                          )
                        )
                          return;
                        await command({
                          type: "document.retry",
                          sourceId: source.id,
                          ...(media
                            ? { allowModelProcessing: true as const }
                            : {}),
                        });
                      })
                    }
                  >
                    {source.processing_error === "MEDIA_DISCLOSURE_REQUIRED"
                      ? uiText("Consenti lettura con AI…")
                      : uiText("Riprova lettura")}
                  </button>
                )}
              {source.work_id &&
                state.research.find((w) => w.id === source.work_id)?.status ===
                  "stale" && (
                  <p>
                    {uiText(
                      "Risultato storico da rivalutare rispetto allo stato corrente.",
                    )}
                  </p>
                )}
              {source.kind === "document" ? (
                <a
                  href={`/api/workspaces/${state.workspace.id}/sources/${source.id}`}
                >
                  {uiText("Scarica originale")}
                </a>
              ) : (
                source.url && (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {uiText("Apri fonte esterna")}
                  </a>
                )
              )}
              <FileVisibilityButton
                file={source}
                command={command}
                action={action}
                busy={busy}
              />
            </div>
            <details>
              <summary>{uiText("Dettagli e origine")}</summary>
              <p className="hint">
                {uiText("Condivisa tramite ")}
                {name(source.contributed_by)} ·{" "}
                {new Date(source.created_at).toLocaleString(uiLocale)}
              </p>
              <p>{source.qualification}</p>
              <p className="source-text">{source.content}</p>
              <p className="hint">
                {source.provider
                  ? uiText("Ricerca: {0} · ", String(source.provider))
                  : ""}
                {uiText("SHA-256: ")}
                {source.content_hash}
              </p>
              {source.extraction_id && (
                <p className="hint">
                  {uiText("Estrazione ")}
                  {source.extraction_provider} ·{" "}
                  {source.extracted_at
                    ? new Date(source.extracted_at).toLocaleString(uiLocale)
                    : ""}{" "}
                  {uiText("· SHA-256 del testo: ")}
                  {source.extraction_hash}
                  {uiText(". L’originale e il testo estratto sono distinti.")}
                </p>
              )}
              {!!source.processing_history?.length && (
                <details>
                  <summary>{uiText("Storia della lettura")}</summary>
                  <ul>
                    {source.processing_history.map((event) => (
                      <li key={event.id}>
                        {new Date(event.created_at).toLocaleString(uiLocale)} ·{" "}
                        {uiText(
                          {
                            started: "Lettura iniziata",
                            published: "Testo estratto disponibile",
                            superseded: "Tentativo superato",
                            access_ended: "Accesso terminato",
                            failed: "Lettura non riuscita",
                            recovered: "Tentativo interrotto, recuperato",
                            retry_requested: "Nuovo tentativo richiesto",
                          }[event.kind] ?? "",
                        ) || event.kind}
                        {event.actor_id ? ` · ${name(event.actor_id)}` : ""}
                        {event.error_code === "MEDIA_DISCLOSURE_REQUIRED"
                          ? uiText(" · Serve il permesso di lettura con AI")
                          : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {source.previous_source_id && (
                <button
                  type="button"
                  className="quiet source-link"
                  onClick={() => openSource(source.previous_source_id!)}
                >
                  {uiText("Versione precedente conservata")}
                </button>
              )}
            </details>
          </article>
        ))}
      {state.sources.some((source) => source.withdrawn) && (
        <details className="source-removed">
          <summary>{uiText("File ritirati")}</summary>
          {state.sources
            .filter((source) => source.withdrawn)
            .map((source) => (
              <div key={source.id} className="source-file-actions">
                <span>{source.filename ?? source.title}</span>
                <FileVisibilityButton
                  file={source}
                  command={command}
                  action={action}
                  busy={busy}
                />
              </div>
            ))}
        </details>
      )}
      {preview && (
        <dialog
          ref={dialog}
          className="source-photo-dialog"
          aria-label={preview.title}
          onCancel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPreviewId(undefined);
          }}
          onClose={(e) => {
            e.stopPropagation();
            setPreviewId(undefined);
          }}
        >
          <header>
            <strong>{preview.title}</strong>
            <button
              type="button"
              className="quiet"
              onClick={() => setPreviewId(undefined)}
            >
              {uiText("Chiudi ")}
              <WorkspaceIcon name="close" />
            </button>
          </header>
          <Image
            unoptimized
            width={960}
            height={720}
            src={`/api/workspaces/${state.workspace.id}/sources/${preview.id}?preview=1`}
            alt={preview.title}
          />
        </dialog>
      )}
      <ProductHelp screen="sources" />
    </section>
  );
}
