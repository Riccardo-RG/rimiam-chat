"use client";
import { ProductHelp } from "./product-help";
import { useEffect, useRef, useState } from "react";
import { api, errors } from "./api";
import type { Command } from "@/contracts/commands";
import {
  conversationReferenceSchema,
  type ConversationReference,
} from "@/contracts/activity";
import type {
  ActiveWorkView,
  ActiveWorkItem,
  ActiveWorkHistory,
} from "@/contracts/active-work";
const phases: Record<string, string> = {
  queued: "In attesa",
  working: "In corso",
  needs_input: "Serve un chiarimento",
  paused: "In pausa",
  stopped: "Fermato",
  completed: "Completato",
};
export function WorkspaceActiveWork({
  workspace,
  actor,
  command,
  action,
  busy,
  name = (id: string) => id,
  compact = false,
  openWork,
  selectedWork,
  resultsOnly = false,
  inspectReference,
}: {
  workspace: string;
  actor: string;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  name?: (id: string) => string;
  compact?: boolean;
  openWork?: (id: string) => void;
  selectedWork?: string;
  resultsOnly?: boolean;
  inspectReference?: (reference: ConversationReference) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const revealed = useRef("");
  const [view, setView] = useState<ActiveWorkView | null>(null),
    [error, setError] = useState(""),
    [before, setBefore] = useState("");
  const [history, setHistory] = useState<{
    id: string;
    data: ActiveWorkHistory;
    nextBefore: number | null;
  } | null>(null);
  const [located, setLocated] = useState<{ id: string; error?: string }>();
  const [locateAttempt, setLocateAttempt] = useState(0);
  useEffect(() => {
    if (!selectedWork || compact) return;
    let live = true;
    const locate = async () => {
      let cursor = "";
      const seen = new Set<string>();
      while (live) {
        const page = await api<ActiveWorkView>(
          `/api/v1/workspaces/${workspace}/active-work${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`,
        );
        if (!live) return;
        if (page.works.some((work) => work.id === selectedWork)) {
          setBefore(cursor);
          setLocated({ id: selectedWork });
          return;
        }
        if (!page.next)
          throw new Error("Il lavoro non è disponibile in questo spazio.");
        if (seen.has(page.next))
          throw new Error("Lettura della storia interrotta. Riprova.");
        seen.add(page.next);
        cursor = page.next;
      }
    };
    void locate().catch((error: unknown) => {
      if (live)
        setLocated({
          id: selectedWork,
          error:
            error instanceof Error
              ? error.message
              : "Lettura del lavoro non riuscita.",
        });
    });
    return () => {
      live = false;
    };
  }, [selectedWork, workspace, actor, compact, locateAttempt]);
  const url = `/api/v1/workspaces/${workspace}/active-work${before ? `?before=${before}` : ""}`;
  useEffect(() => {
    let live = true,
      running = false;
    const read = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const v = await api<ActiveWorkView>(url);
        if (live) {
          setView(v);
          setError("");
        }
      } catch (e) {
        if (live) {
          setView(null);
          setHistory(null);
          setError((e as Error).message);
        }
      } finally {
        running = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [url, actor]);
  useEffect(() => {
    if (!selectedWork || revealed.current === selectedWork) return;
    const detail = section.current?.querySelector<HTMLDetailsElement>(
      `[data-work-id="${CSS.escape(selectedWork)}"]`,
    );
    if (detail) {
      detail.open = true;
      detail.scrollIntoView({ block: "nearest" });
      revealed.current = selectedWork;
    }
  }, [selectedWork, view]);
  const perform = async (
    work: ActiveWorkItem,
    text: string,
    instruction?: "input" | "assumption" | "objection" | "redirect" | "format",
  ) => {
    let committed = false;
    await action(async () => {
      await command({
        type: "work.converse",
        workId: work.id,
        expectedRevision: work.revision,
        text,
        ...(instruction ? { instruction } : {}),
      });
      committed = true;
      await refreshAfterCommit();
    });
    return committed;
  };
  const refreshAfterCommit = async () => {
    try {
      setView(await api<ActiveWorkView>(url));
    } catch {
      setError(
        "Operazione registrata. Non è stato possibile aggiornare la vista: sarà ricaricata automaticamente.",
      );
    }
  };
  const inspect = (id: string, before?: number) =>
    action(async () => {
      const data = await api<ActiveWorkHistory>(
        `/api/v1/workspaces/${workspace}/active-work-history?id=${id}${before ? `&before=${before}` : ""}`,
      );
      setHistory({ id, data, nextBefore: data.nextBefore });
    });
  if (compact) {
    const needsInput =
      view?.works.filter((work) => work.phase === "needs_input") ?? [];
    const visible = [
      ...needsInput,
      ...(
        view?.works.filter((work) => work.phase !== "needs_input") ?? []
      ).slice(0, Math.max(0, 2 - needsInput.length)),
    ];
    return (
      <div className="work-activity" aria-label="Il lavoro di RIMIAM">
        {error && (
          <span role="status">
            Stato del lavoro non disponibile.{" "}
            <button className="quiet" onClick={() => openWork?.("")}>
              Verifica
            </button>
          </span>
        )}
        {visible.map((work) => (
          <button
            key={work.id}
            className={`activity-pill phase-${work.phase}`}
            onClick={() => openWork?.(work.id)}
          >
            <span className="activity-dot" aria-hidden="true" />
            <span>
              <strong>{work.contract.objective}</strong>
              <small>
                {phases[work.phase]}
                {work.validity === "potentially_outdated"
                  ? " · Potenzialmente superato"
                  : ""}
              </small>
            </span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <section ref={section} aria-label="Active Work" className="work-presence">
      <h3>{resultsOnly ? "I contributi di RIMIAM" : "Il lavoro di RIMIAM"}</h3>
      <ProductHelp screen="active_work" />

      {selectedWork && located?.id !== selectedWork && (
        <p role="status">Apertura del lavoro selezionato…</p>
      )}
      {selectedWork && located?.id === selectedWork && located.error && (
        <p role="alert">
          {located.error}
          <button
            className="quiet"
            onClick={() => setLocateAttempt((n) => n + 1)}
          >
            Riprova
          </button>
        </p>
      )}

      {error && <p role="alert">{error}</p>}
      {view &&
        !view.works.some((work) => !resultsOnly || work.contribution) && (
          <p className="muted">
            {resultsOnly
              ? "I risultati prodotti compariranno qui, distinti dai contenuti adottati."
              : "Le analisi che portiamo avanti compariranno qui."}
          </p>
        )}
      {view?.works
        .filter((work) => !resultsOnly || work.contribution)
        .map((work) => (
          <details
            key={work.id}
            data-testid="active-work"
            data-work-id={work.id}
          >
            <summary>
              {work.contract.objective} · {phases[work.phase]}
              {work.validity === "potentially_outdated"
                ? " · Potenzialmente superato"
                : ""}
            </summary>
            <p>{work.contract.scope}</p>
            {view.suggestions
              .filter((s) => s.workId === work.id && s.status !== "applied")
              .map((s) => (
                <div key={s.id} className="hint">
                  <strong>Miriam propone: {s.operation}</strong>
                  <p>{s.text}</p>
                  <small>
                    Interpretazione del messaggio {s.sourceId}; non ancora
                    applicata.{" "}
                    {s.status === "stale"
                      ? "Il lavoro è cambiato: questa proposta va rivalutata."
                      : ""}
                  </small>
                  {s.status === "pending" && view.canControl && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await command({
                            type: "work.apply_suggestion",
                            suggestionId: s.id,
                            confirmExactInstruction: true,
                          });
                          await refreshAfterCommit();
                        })
                      }
                    >
                      Applica questa istruzione al lavoro
                    </button>
                  )}
                </div>
              ))}
            <p>
              Output: {work.contract.expectedOutput} · Contratto v
              {work.contract.version}
            </p>
            <p className="muted">
              {work.contract.origin === "miriam"
                ? "Iniziativa di Miriam"
                : `Richiesto da ${name(work.contract.actor!)}`}{" "}
              · {work.contract.createdAt}
            </p>
            {work.contract.anchors.map((a, i) => (
              <p key={i}>Ipotesi: {a}</p>
            ))}
            {work.error && (
              <p role="status">
                {errors[work.error] ??
                  "Analisi non completata. Il lavoro è conservato; verifica gli input prima di riprendere."}
              </p>
            )}
            {work.issues.map((issue) => (
              <div key={issue.id}>
                <p>{issue.content}</p>
                <small>Riferimento: {issue.id}</small>
                {view.canControl &&
                  issue.kind === "revision" &&
                  issue.requiredPeople.includes(actor) &&
                  !issue.acknowledgedBy.includes(actor) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(work, `confermo: ${issue.id}`)
                      }
                    >
                      Conferma questa direzione
                    </button>
                  )}
                {view.canControl && issue.actor === actor && (
                  <button
                    disabled={busy}
                    onClick={() => void perform(work, `ritiro: ${issue.id}`)}
                  >
                    Ritira la tua richiesta
                  </button>
                )}
                {view.canControl && issue.kind === "context" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(work, "usa contesto aggiornato")
                    }
                  >
                    Usa il contesto aggiornato per l’analisi
                  </button>
                )}
              </div>
            ))}
            {work.contribution && (
              <article>
                <strong>
                  Contributo non adottato · contratto v
                  {work.contribution.contractVersion}
                </strong>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {work.contribution.body}
                </p>
                <p>{work.contribution.qualification}</p>
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await command({
                        type: "artifact.from_contribution",
                        contributionId: work.contribution!.id,
                        title: work.contract.objective.slice(0, 160),
                        purpose:
                          "Valutare e sviluppare il contributo di Miriam",
                        nonOperative: true,
                      });
                    })
                  }
                >
                  Prepara una bozza da questo contributo
                </button>
                <details>
                  <summary>Riferimenti citati</summary>
                  {work.contribution.citations.map((c) => (
                    <p key={c}>{c}</p>
                  ))}
                  <button
                    className="quiet"
                    onClick={() => void inspect(work.id)}
                  >
                    Apri il materiale utilizzato e la sua provenienza
                  </button>
                </details>
              </article>
            )}
            {view.canControl && (
              <>
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() => void perform(work, "pausa")}
                  >
                    Pausa
                  </button>
                  <button
                    disabled={busy || work.issues.length > 0}
                    onClick={() => void perform(work, "riprendi")}
                  >
                    Riprendi
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void perform(work, "ferma")}
                  >
                    Ferma
                  </button>
                </div>
                <WorkInstruction
                  key={work.id}
                  busy={busy}
                  send={(text, instruction) => perform(work, text, instruction)}
                />
              </>
            )}
            <button onClick={() => void inspect(work.id)}>
              Storia e provenance
            </button>
            {view.events
              .filter((e) => e.workId === work.id)
              .slice(-5)
              .map((e) => (
                <p key={e.id} className="muted">
                  {e.content} · {e.createdAt}
                </p>
              ))}
          </details>
        ))}
      {before && <button onClick={() => setBefore("")}>Lavori recenti</button>}
      {view?.next && (
        <button onClick={() => setBefore(view.next!)}>Altri lavori</button>
      )}
      {history && (
        <details open>
          <summary>Storia del lavoro</summary>
          {history.data.contracts.map((c) => (
            <div className="history-entry" key={c.version}>
              <strong>
                Contratto v{c.version} · {c.objective}
              </strong>
              <p>{c.scope}</p>
              <p>{c.expectedOutput}</p>
              {c.anchors.map((a, i) => (
                <p key={i}>Ipotesi: {a}</p>
              ))}
              <small>
                {c.actor ? name(c.actor) : "Miriam"} ·{" "}
                {new Date(c.createdAt).toLocaleString("it-IT")} · {c.reason}
              </small>
            </div>
          ))}
          <details>
            <summary>Eventi significativi</summary>
            {history.data.events.map((e) => (
              <div className="history-entry" key={e.id}>
                <p>{e.content}</p>
                <small>
                  {e.actor ? name(e.actor) : "Miriam"} ·{" "}
                  {new Date(e.createdAt).toLocaleString("it-IT")}
                </small>
              </div>
            ))}
          </details>
          <details>
            <summary>Materiale utilizzato</summary>
            {history.data.inputs.map((i, n) => {
              const reference = conversationReferenceSchema.safeParse(
                i.provenance.reference,
              );
              return (
                <div className="history-entry" key={n}>
                  <strong>
                    {i.kind} · v{i.version}
                  </strong>
                  <p>{i.content}</p>
                  <small>{i.qualification}</small>
                  <small>Riferimento: {i.id}</small>
                  {reference.success && inspectReference && (
                    <button
                      className="quiet"
                      onClick={() => inspectReference(reference.data)}
                    >
                      Apri questa versione di origine
                    </button>
                  )}
                </div>
              );
            })}
          </details>
          <details>
            <summary>Contributi prodotti, non adottati</summary>
            {history.data.contributions.map((c) => (
              <div className="history-entry" key={c.id}>
                <p>{c.body}</p>
                <small>
                  {c.qualification} · Contratto v{c.contractVersion}
                </small>
              </div>
            ))}
          </details>
          {history.nextBefore && (
            <button
              onClick={() => void inspect(history.id, history.nextBefore!)}
            >
              Eventi precedenti
            </button>
          )}
          <button onClick={() => setHistory(null)}>Chiudi storia</button>
        </details>
      )}
    </section>
  );
}
function WorkInstruction({
  busy,
  send,
}: {
  busy: boolean;
  send: (
    text: string,
    instruction?: "input" | "assumption" | "objection" | "redirect" | "format",
  ) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState<
    "input" | "assumption" | "objection" | "redirect" | "format"
  >("input");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const submitted = text;
        void send(submitted, instruction).then((committed) => {
          if (committed)
            setText((current) => (current === submitted ? "" : current));
        });
      }}
    >
      <label>
        Come vuoi contribuire?
        <select
          value={instruction}
          onChange={(e) => {
            setInstruction(e.target.value as typeof instruction);
          }}
        >
          <option value="input">Aggiungere informazioni</option>
          <option value="assumption">Fissare un’ipotesi analitica</option>
          <option value="objection">Segnalare un limite o un’obiezione</option>
          <option value="redirect">Proporre una direzione diversa</option>
          <option value="format">Scegliere il formato</option>
        </select>
      </label>
      <label>
        Istruzione per questo lavoro
        {instruction === "format" ? (
          <select
            aria-label="Istruzione per questo lavoro"
            value={text}
            onChange={(e) => setText(e.target.value)}
          >
            <option value="">Scegli un formato</option>
            <option value="sintesi">Sintesi</option>
            <option value="elenco">Elenco</option>
            <option value="dettagli">Analisi dettagliata</option>
          </select>
        ) : (
          <textarea
            aria-label="Istruzione per questo lavoro"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Spiega a Miriam ciò che serve per proseguire…"
            rows={2}
            maxLength={4000}
          />
        )}
      </label>
      <p className="muted">
        Le istruzioni riguardano questa analisi. Non modificano decisioni o
        impegni dello spazio.
      </p>
      <button disabled={busy || !text.trim()}>Invia istruzione</button>
    </form>
  );
}
