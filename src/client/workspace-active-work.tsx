"use client";
import { useUiLanguage } from "./ui-language";

import { workEventSummary } from "@/shared/assistant-presentation";
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
  selectedWork,
  selectedCompletion,
  showAllWork,
  savedContributions = [],
  askInChat,
  inspectReference,
}: {
  workspace: string;
  actor: string;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  name?: (id: string) => string;
  selectedWork?: string;
  selectedCompletion?: number;
  showAllWork?: () => void;
  savedContributions?: string[];
  askInChat?: (ref: ConversationReference, title: string) => void;
  inspectReference?: (reference: ConversationReference) => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
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
  const readScope = useRef(0);
  const readRequest = useRef(0);
  const query = selectedWork
    ? `?workId=${encodeURIComponent(selectedWork)}${selectedCompletion ? "&completion=" + selectedCompletion : ""}`
    : before
      ? `?before=${encodeURIComponent(before)}`
      : "";
  const url = `/api/v1/workspaces/${workspace}/active-work${query}`;
  useEffect(() => {
    const scope = ++readScope.current;
    let running = false;
    const read = async () => {
      if (running || document.hidden) return;
      running = true;
      const request = ++readRequest.current;
      try {
        const v = await api<ActiveWorkView>(url);
        if (scope === readScope.current && request === readRequest.current) {
          setView(v);
          setError("");
        }
      } catch (e) {
        if (scope === readScope.current && request === readRequest.current) {
          setView(null);
          setHistory(null);
          setError(
            errors[(e as Error).message] ??
              uiText("Il lavoro non è disponibile. Riprova tra poco."),
          );
        }
      } finally {
        running = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      readScope.current = scope + 1;
      clearInterval(timer);
    };
  }, [url, actor, uiText]);
  useEffect(() => {
    if (!selectedWork || revealed.current === selectedWork) return;
    const detail = section.current?.querySelector<HTMLDetailsElement>(
      `[data-work-id="${CSS.escape(selectedWork)}"]`,
    );
    if (detail) {
      detail.open = true;
      const destination =
        detail.querySelector<HTMLElement>("[data-work-focus]") ?? detail;
      destination.focus({ preventScroll: true });
      destination.scrollIntoView({ block: "nearest" });
      revealed.current = selectedWork;
    }
  }, [selectedWork, view]);
  const perform = async (
    work: ActiveWorkItem,
    text: string,
    instruction?: "input" | "assumption" | "objection" | "redirect" | "format",
  ) => {
    const scope = readScope.current;
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
      await refreshAfterCommit(scope);
    });
    return committed;
  };
  const refreshAfterCommit = async (scope: number) => {
    if (scope !== readScope.current) return;
    // Polls and command refreshes share ordering; an older response cannot
    // replace a newer view or publish into a different pagination scope.
    const request = ++readRequest.current;
    try {
      const v = await api<ActiveWorkView>(url);
      if (scope === readScope.current && request === readRequest.current) {
        setView(v);
        setError("");
      }
    } catch {
      if (scope === readScope.current && request === readRequest.current)
        setError(
          uiText(
            "Operazione registrata. Non è stato possibile aggiornare la vista: sarà ricaricata automaticamente.",
          ),
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
  return (
    <section
      ref={section}
      aria-label={uiText("Active Work")}
      className="work-presence"
    >
      <h3>{uiText("Il lavoro di Emme")}</h3>

      {selectedWork && (
        <button type="button" className="quiet" onClick={showAllWork}>
          {uiText("Tutti i lavori")}
        </button>
      )}
      {!view && !error && (
        <p className="hint" role="status">
          {selectedWork
            ? uiText("Apertura del lavoro selezionato…")
            : uiText("Caricamento delle analisi…")}
        </p>
      )}

      {error && <p role="alert">{error}</p>}
      {view && !view.works.length && (
        <p className="muted">
          {uiText("Le analisi richieste in chat appariranno qui.")}
        </p>
      )}
      {view?.works.map((work) => (
        <details key={work.id} data-testid="active-work" data-work-id={work.id}>
          <summary>
            {work.contract.objective} · {uiText(phases[work.phase])}
            {work.validity === "potentially_outdated"
              ? uiText(" · Potenzialmente superato")
              : ""}
          </summary>
          <p>{work.contract.scope}</p>
          {view.suggestions
            .filter((s) => s.workId === work.id && s.status !== "applied")
            .map((s) => (
              <div key={s.id} className="hint">
                <strong>
                  {uiText("Emme propone: ")}
                  {s.operation}
                </strong>
                <p>{s.text}</p>
                <small>
                  {uiText("Interpretazione del messaggio ")}
                  {s.sourceId}
                  {uiText("; non ancora applicata.")}{" "}
                  {s.status === "stale"
                    ? uiText(
                        "Il lavoro è cambiato: questa proposta va rivalutata.",
                      )
                    : ""}
                </small>
                {s.status === "pending" && view.canControl && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const scope = readScope.current;
                        await command({
                          type: "work.apply_suggestion",
                          suggestionId: s.id,
                          confirmExactInstruction: true,
                        });
                        await refreshAfterCommit(scope);
                      })
                    }
                  >
                    {uiText("Applica questa istruzione al lavoro")}
                  </button>
                )}
              </div>
            ))}
          <p>
            {uiText("Risultato richiesto: ")}
            {work.contract.expectedOutput}
            {uiText(" · Contratto v")}
            {work.contract.version}
          </p>
          <p className="muted">
            {work.contract.origin === "miriam"
              ? uiText("Iniziativa di Emme")
              : uiText(
                  "Richiesto da {0}",
                  String(name(work.contract.actor!)),
                )}{" "}
            · {work.contract.createdAt}
          </p>
          {work.contract.anchors.map((a, i) => (
            <p key={i}>
              {uiText("Ipotesi: ")}
              {a}
            </p>
          ))}
          {work.error && (
            <p
              role="status"
              tabIndex={-1}
              data-work-focus={work.phase === "needs_input" || undefined}
            >
              {errors[work.error] ??
                uiText(
                  "L’analisi si è fermata. Il lavoro è salvato. Controlla il materiale e le istruzioni prima di riprendere.",
                )}
            </p>
          )}
          {work.issues.map((issue) => (
            <div
              key={issue.id}
              tabIndex={-1}
              data-work-focus={work.phase === "needs_input" || undefined}
            >
              <p>{issue.content}</p>
              <small>
                {uiText("Riferimento: ")}
                {issue.id}
              </small>
              {view.canControl &&
                issue.kind === "revision" &&
                issue.requiredPeople.includes(actor) &&
                !issue.acknowledgedBy.includes(actor) && (
                  <button
                    disabled={busy}
                    onClick={() => void perform(work, `confermo: ${issue.id}`)}
                  >
                    {uiText("Conferma questa direzione")}
                  </button>
                )}
              {view.canControl && issue.actor === actor && (
                <button
                  disabled={busy}
                  onClick={() => void perform(work, `ritiro: ${issue.id}`)}
                >
                  {uiText("Ritira la tua richiesta")}
                </button>
              )}
              {view.canControl && issue.kind === "context" && (
                <button
                  disabled={busy}
                  onClick={() => void perform(work, "usa contesto aggiornato")}
                >
                  {uiText("Usa il contesto aggiornato per l’analisi")}
                </button>
              )}
            </div>
          ))}
          {work.contribution && (
            <article
              tabIndex={-1}
              data-work-focus={
                !!selectedCompletion || work.phase === "completed" || undefined
              }
            >
              <strong>
                {uiText("Contributo non adottato · contratto v")}
                {work.contribution.contractVersion}
              </strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{work.contribution.body}</p>
              <p>{work.contribution.qualification}</p>
              {askInChat && (
                <button
                  className="quiet"
                  onClick={() =>
                    askInChat(
                      {
                        kind: "active_work",
                        id: work.id,
                        version: selectedCompletion ?? work.revision,
                      },
                      work.contribution?.objective ?? work.contract.objective,
                    )
                  }
                >
                  {uiText("Chiedi in chat")}
                </button>
              )}
              <button
                className="quiet"
                disabled={
                  busy ||
                  !view.canControl ||
                  savedContributions.includes(work.contribution.id)
                }
                onClick={() =>
                  void action(async () => {
                    await command({
                      type: "artifact.from_contribution",
                      saveToLibrary: true,
                      contributionId: work.contribution!.id,
                      title: (
                        work.contribution?.objective ?? work.contract.objective
                      ).slice(0, 160),
                      purpose: "Valutare e sviluppare il contributo di Emme",
                      nonOperative: true,
                    });
                  })
                }
              >
                {savedContributions.includes(work.contribution.id)
                  ? uiText("Salvato in Condivisi")
                  : uiText("Salva in Condivisi")}
              </button>
              <ContributionSources
                sources={work.contribution.sources ?? []}
                inspectReference={inspectReference}
              />
            </article>
          )}
          {view.canControl && (
            <>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() => void perform(work, "pausa")}
                >
                  {uiText("Pausa")}
                </button>
                <button
                  disabled={busy || work.issues.length > 0}
                  onClick={() => void perform(work, "riprendi")}
                >
                  {uiText("Riprendi")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void perform(work, "ferma")}
                >
                  {uiText("Ferma")}
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
            {uiText("Cronologia e fonti")}
          </button>
          {view.events
            .filter((e) => e.workId === work.id)
            .slice(-5)
            .map((e) => (
              <p key={e.id} className="muted">
                {workEventSummary(e.kind, e.content)} · {e.createdAt}
              </p>
            ))}
        </details>
      ))}
      {before && (
        <button onClick={() => setBefore("")}>
          {uiText("Lavori recenti")}
        </button>
      )}
      {view?.next && (
        <button onClick={() => setBefore(view.next!)}>
          {uiText("Altri lavori")}
        </button>
      )}
      {history && (
        <details open>
          <summary>{uiText("Storia del lavoro")}</summary>
          {history.data.contracts.map((c) => (
            <div className="history-entry" key={c.version}>
              <strong>
                {uiText("Contratto v")}
                {c.version} · {c.objective}
              </strong>
              <p>{c.scope}</p>
              <p>{c.expectedOutput}</p>
              {c.anchors.map((a, i) => (
                <p key={i}>
                  {uiText("Ipotesi: ")}
                  {a}
                </p>
              ))}
              <small>
                {c.actor ? name(c.actor) : uiText("Emme")} ·{" "}
                {new Date(c.createdAt).toLocaleString(uiLocale)} · {c.reason}
              </small>
            </div>
          ))}
          <details>
            <summary>{uiText("Eventi significativi")}</summary>
            {history.data.events.map((e) => (
              <div className="history-entry" key={e.id}>
                <p>{e.content}</p>
                <small>
                  {e.actor ? name(e.actor) : uiText("Emme")} ·{" "}
                  {new Date(e.createdAt).toLocaleString(uiLocale)}
                </small>
              </div>
            ))}
          </details>
          <details>
            <summary>{uiText("Materiale utilizzato")}</summary>
            {history.data.inputs.map((i, n) => {
              const reference = conversationReferenceSchema.safeParse(
                i.provenance.reference,
              );
              return (
                <div className="history-entry" key={n}>
                  <strong>
                    {i.kind}
                    {uiText(" · v")}
                    {i.version}
                  </strong>
                  <p>{i.content}</p>
                  <small>{i.qualification}</small>
                  <small>
                    {uiText("Riferimento: ")}
                    {i.id}
                  </small>
                  {reference.success && inspectReference && (
                    <button
                      className="quiet"
                      onClick={() => inspectReference(reference.data)}
                    >
                      {uiText("Apri la fonte citata")}
                    </button>
                  )}
                </div>
              );
            })}
          </details>
          <details>
            <summary>{uiText("Contributi prodotti, non adottati")}</summary>
            {history.data.contributions.map((c) => (
              <div className="history-entry" key={c.id}>
                <p>{c.body}</p>
                <small>
                  {c.qualification}
                  {uiText(" · Contratto v")}
                  {c.contractVersion}
                </small>
              </div>
            ))}
          </details>
          {history.nextBefore && (
            <button
              onClick={() => void inspect(history.id, history.nextBefore!)}
            >
              {uiText("Eventi precedenti")}
            </button>
          )}
          <button onClick={() => setHistory(null)}>
            {uiText("Chiudi storia")}
          </button>
        </details>
      )}
      <ProductHelp screen="active_work" />
    </section>
  );
}
function ContributionSources({
  sources,
  inspectReference,
}: {
  sources: NonNullable<NonNullable<ActiveWorkItem["contribution"]>["sources"]>;
  inspectReference?: (reference: ConversationReference) => void;
}) {
  const { t: uiText } = useUiLanguage();
  if (!sources.length) return null;
  const links = sources.map((source) =>
    source.reference && inspectReference ? (
      <button
        type="button"
        className="quiet"
        key={source.key}
        onClick={() => inspectReference(source.reference!)}
      >
        {sources.length === 1 ? uiText("Fonte · ") : ""}
        {source.label}
      </button>
    ) : (
      <details key={source.key}>
        <summary>{source.label}</summary>
        <p>{source.excerpt ?? uiText("Origine non disponibile.")}</p>
      </details>
    ),
  );
  if (sources.length === 1) return <div>{links}</div>;
  return (
    <details>
      <summary>
        {sources.length}
        {uiText(" fonti")}
      </summary>
      {links}
    </details>
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
  const { t: uiText } = useUiLanguage();
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
        {uiText("Come vuoi contribuire?")}
        <select
          value={instruction}
          onChange={(e) => {
            setInstruction(e.target.value as typeof instruction);
          }}
        >
          <option value="input">{uiText("Aggiungere informazioni")}</option>
          <option value="assumption">
            {uiText("Indicare un’ipotesi da verificare")}
          </option>
          <option value="objection">
            {uiText("Segnalare un limite o un’obiezione")}
          </option>
          <option value="redirect">
            {uiText("Proporre una direzione diversa")}
          </option>
          <option value="format">{uiText("Scegliere il formato")}</option>
        </select>
      </label>
      <label>
        {uiText("Istruzione per questo lavoro")}
        {instruction === "format" ? (
          <select
            aria-label={uiText("Istruzione per questo lavoro")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          >
            <option value="">{uiText("Scegli un formato")}</option>
            <option value="sintesi">{uiText("Sintesi")}</option>
            <option value="elenco">{uiText("Elenco")}</option>
            <option value="dettagli">{uiText("Analisi dettagliata")}</option>
          </select>
        ) : (
          <textarea
            aria-label={uiText("Istruzione per questo lavoro")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={uiText("Spiega a Emme ciò che serve per proseguire…")}
            rows={2}
            maxLength={4000}
          />
        )}
      </label>
      <p className="muted">
        {uiText(
          "Le istruzioni riguardano questa analisi. Non modificano decisioni o impegni dello spazio.",
        )}
      </p>
      <button disabled={busy || !text.trim()}>
        {uiText("Invia istruzione")}
      </button>
    </form>
  );
}
