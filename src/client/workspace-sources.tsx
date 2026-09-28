"use client";
import { humanCallActive } from "./call-audio-focus";
import { useState, useRef, useEffect } from "react";
import { newCommand, sendCommand } from "./command-journal";
import type { Snapshot } from "./types";
import type { Command } from "@/contracts/commands";

const statuses: Record<string, string> = {
  queued: "In attesa",
  running: "Ricerca in corso",
  completed: "Risultati disponibili",
  failed: "Ricerca non riuscita",
  stale: "Da rivalutare: le condizioni sono cambiate",
  cancelled: "Interrotta",
  needs_configuration: "Ricerca web da attivare",
};
export function WorkspaceSources({
  state,
  actor,
  command,
  action,
  reload,
  busy,
}: {
  state: Snapshot;
  actor: string;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  reload: () => Promise<void>;
  busy: boolean;
}) {
  const [previous, setPrevious] = useState("");
  const [questionLink, setQuestionLink] = useState("");
  const [queryText, setQueryText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
  const needsModel =
    !!selectedFile &&
    /\.(png|jpe?g|webp|m4a|mp3|wav|webm|ogg)$/i.test(selectedFile.name);
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
  return (
    <section className="card source-work" aria-label="Fonti e ricerche">
      <details>
        <summary>
          Documenti e ricerca web
          {state.research.some(
            (w) => w.status === "running" || w.status === "queued",
          )
            ? " · Lavoro in corso"
            : ""}
        </summary>
        <h2>Fonti e ricerche</h2>
        <p className="hint">
          Aggiungi materiale o cerca informazioni utili al Goal. Le fonti
          diventano riferimenti di lavoro soltanto dopo un’accettazione
          esplicita.
        </p>
        {mayContribute && (
          <div className="source-forms">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const file = selectedFile;
                void action(async () => {
                  if (!file) throw new Error("DOCUMENT_REQUIRED");
                  if (file.size > 8388608)
                    throw new Error("DOCUMENT_TOO_LARGE");
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  let binary = "";
                  for (const b of bytes) binary += String.fromCharCode(b);
                  await sendCommand(
                    newCommand(actor, state.workspace.id, {
                      type: "document.upload",
                      filename: file.name,
                      bytesBase64: btoa(binary),
                      ...(allowModelProcessing
                        ? { allowModelProcessing: true as const }
                        : {}),
                      ...(previous ? { previousSourceId: previous } : {}),
                    }),
                  );
                  form.reset();
                  setPrevious("");
                  setSelectedFile(null);
                  setAllowModelProcessing(false);
                  await reload();
                });
              }}
            >
              <h3>Condividi una fonte</h3>
              <label>
                Documento, immagine o messaggio vocale
                <input
                  name="document"
                  type="file"
                  accept=".txt,.md,.csv,.pdf,.docx,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.webm,.ogg"
                  onChange={(e) => {
                    setSelectedFile(e.target.files?.[0] ?? null);
                    setAllowModelProcessing(false);
                  }}
                  disabled={busy}
                />
              </label>
              <p className="hint">
                File fino a 8 MB; testo estratto fino a 200.000 caratteri. PDF e
                DOCX vengono letti localmente. Tutti i membri attuali e futuri
                dello spazio potranno leggerlo.
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
                  ? "Termina registrazione"
                  : "Registra un messaggio vocale"}
              </button>
              {recording && (
                <p role="status">
                  Registrazione in corso. Il messaggio sarà condiviso solo
                  quando lo invii.
                </p>
              )}
              {selectedFile && (
                <p className="hint">Selezionato: {selectedFile.name}</p>
              )}
              {needsModel && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={allowModelProcessing}
                    onChange={(e) => setAllowModelProcessing(e.target.checked)}
                  />
                  Consento l’invio di questa immagine o registrazione al
                  servizio AI configurato per leggerla. L’originale rimane nello
                  spazio.
                </label>
              )}
              <label>
                Versione di
                <select
                  value={previous}
                  onChange={(e) => setPrevious(e.target.value)}
                >
                  <option value="">Nuovo documento</option>
                  {state.sources
                    .filter(
                      (s) =>
                        s.kind === "document" &&
                        !state.sources.some(
                          (n) => n.previous_source_id === s.id,
                        ),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} · v{s.document_version}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={
                  busy ||
                  recording ||
                  !selectedFile ||
                  (needsModel && !allowModelProcessing)
                }
              >
                Condividi documento
              </button>
            </form>
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
              <h3>Cerca sul web</h3>
              {state.questions.length > 0 && (
                <label>
                  Domanda collegata
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
                    <option value="">Ricerca indipendente</option>
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
                Che cosa serve sapere?
                <input
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  name="query"
                  maxLength={500}
                  required
                  placeholder="Come validare RIMIAM con i primi utenti beta"
                />
              </label>
              <label className="check">
                <input type="checkbox" required />
                Autorizzo l’invio del solo testo della ricerca al servizio
                esterno. Non includo dati che non posso condividere.
              </label>
              <button disabled={busy}>Avvia ricerca</button>
            </form>
          </div>
        )}
        {state.research.map((work) => (
          <article
            key={work.id}
            className="source-work-item"
            aria-label={`Ricerca: ${work.query}`}
          >
            <h3>{work.query}</h3>
            <p>
              {statuses[work.status] ?? work.status} · richiesta di{" "}
              {name(work.requested_by)}
            </p>
            {work.status === "needs_configuration" && (
              <p className="hint">
                Il servizio di ricerca non è ancora collegato. La richiesta è
                conservata; puoi continuare a lavorare nello spazio.
              </p>
            )}
            {work.status === "failed" && (
              <p className="hint">
                Nessun risultato è stato accettato. Puoi riprovare quando il
                servizio è disponibile.
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
                    Riprova ricerca
                  </button>
                )}
                {[
                  "queued",
                  "running",
                  "needs_configuration",
                  "failed",
                ].includes(work.status) && (
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
                    Interrompi ricerca
                  </button>
                )}
              </div>
            )}
            <details>
              <summary>Perché e cronologia</summary>
              <a href={`#source-${work.request_source_id}`}>
                Richiesta originale
              </a>
              <ul>
                {state.researchEvents
                  .filter((e) => e.work_id === work.id)
                  .map((e, i) => (
                    <li key={i}>
                      {new Date(e.created_at).toLocaleString("it-IT")} ·{" "}
                      {statuses[e.status] ?? e.status}
                    </li>
                  ))}
              </ul>
            </details>
          </article>
        ))}
        {state.sources.map((source) => (
          <article
            key={source.id}
            id={`source-${source.id}`}
            className="source-work-item"
          >
            <h3>
              {source.kind === "document" ? "Documento" : "Fonte web"} ·{" "}
              {source.title}
              {source.document_version ? ` · v${source.document_version}` : ""}
            </h3>
            <p className="hint">
              Condivisa tramite {name(source.contributed_by)} ·{" "}
              {new Date(source.created_at).toLocaleString("it-IT")}
            </p>
            <p>{source.qualification}</p>
            {source.processing_status && (
              <p role="status">
                {processingLabels[source.processing_status] ??
                  source.processing_status}
                {source.processing_error ? ` · ${source.processing_error}` : ""}
              </p>
            )}
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
                          "Riprova inviando questa fonte al servizio AI configurato per leggerla?",
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
                  Riprova lettura
                </button>
              )}
            {source.work_id &&
              state.research.find((w) => w.id === source.work_id)?.status ===
                "stale" && (
                <p>
                  Risultato storico da rivalutare rispetto allo stato corrente.
                </p>
              )}
            {source.kind === "document" ? (
              <a
                href={`/api/workspaces/${state.workspace.id}/sources/${source.id}`}
              >
                Scarica originale
              </a>
            ) : (
              source.url && (
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  Apri fonte esterna
                </a>
              )
            )}
            <details>
              <summary>Contenuto e provenance</summary>
              <p className="source-text">{source.content}</p>
              <p className="hint">
                {source.provider ? `Ricerca: ${source.provider} · ` : ""}
                SHA-256: {source.content_hash}
              </p>
              {source.extraction_id && (
                <p className="hint">
                  Estrazione {source.extraction_provider} ·{" "}
                  {source.extracted_at
                    ? new Date(source.extracted_at).toLocaleString("it-IT")
                    : ""}{" "}
                  · SHA-256 del testo: {source.extraction_hash}. L’originale e
                  il testo estratto sono distinti.
                </p>
              )}
              {!!source.processing_history?.length && (
                <details>
                  <summary>Storia della lettura</summary>
                  <ul>
                    {source.processing_history.map((event) => (
                      <li key={event.id}>
                        {new Date(event.created_at).toLocaleString("it-IT")} ·{" "}
                        {{
                          started: "Lettura iniziata",
                          published: "Testo estratto disponibile",
                          superseded: "Tentativo superato",
                          access_ended: "Accesso terminato",
                          failed: "Lettura non riuscita",
                          recovered: "Tentativo interrotto, recuperato",
                          retry_requested: "Nuovo tentativo richiesto",
                        }[event.kind] ?? event.kind}
                        {event.actor_id ? ` · ${name(event.actor_id)}` : ""}
                        {event.error_code ? ` · ${event.error_code}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {source.previous_source_id && (
                <a href={`#source-${source.previous_source_id}`}>
                  Versione precedente conservata
                </a>
              )}
            </details>
          </article>
        ))}
      </details>
    </section>
  );
}
