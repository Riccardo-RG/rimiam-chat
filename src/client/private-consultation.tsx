"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import { api, errorText } from "./api";
import type {
  ConsultationInput,
  ConsultationReceipt,
  ConsultationTurn,
  ConsultationRef,
  PrivateConsultation,
} from "../contracts/private-consultation";
import { EmmeMessageMark } from "./brand-signature";
import type { Snapshot } from "./types";

export function ConsultationEvidence({
  state,
  entry,
  openSource,
}: {
  state: {
    workspace: Pick<Snapshot["workspace"], "id">;
    candidates: Snapshot["candidates"];
  };
  entry: ConsultationRef;
  openSource: (id: string) => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [timing, setTiming] = useState<{
    starts_at: string;
    ends_at: string;
    reason: string;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (entry.kind !== "temporal_commitment") return;
    const abort = new AbortController();
    void api<{
      versions: {
        version: number;
        starts_at: string;
        ends_at: string;
        reason: string;
      }[];
    }>(
      "/api/v1/workspaces/" +
        state.workspace.id +
        "/calendar-history?id=" +
        entry.id +
        "&kind=commitment",
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        const version = result.versions.find(
          (v) => v.version === entry.version,
        );
        if (version) setTiming(version);
        else setError(uiText("La versione citata non è disponibile."));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    return () => abort.abort();
  }, [entry.kind, entry.id, entry.version, state.workspace.id, uiText]);
  const candidate =
    entry.kind === "candidate" && entry.version === 1
      ? state.candidates.find((c) => c.id === entry.id)
      : undefined;
  if (candidate)
    return (
      <section>
        <h3>{candidate.subject}</h3>
        <p>{candidate.content}</p>
        <small>{candidate.qualification}</small>
        <div>
          {candidate.source_ids.map((id, i) => (
            <button
              type="button"
              className="quiet"
              key={id}
              onClick={() => openSource(id)}
            >
              {uiText("Fonte originale ")}
              {candidate.source_ids.length > 1 ? i + 1 : ""}
            </button>
          ))}
        </div>
      </section>
    );
  if (entry.kind === "temporal_commitment")
    return (
      <section>
        <h3>
          {uiText("Scadenza dell’impegno · v")}
          {entry.version}
        </h3>
        {error ? (
          <p role="alert">{error}</p>
        ) : timing ? (
          <>
            <p>
              {new Date(timing.starts_at).toLocaleString(uiLocale)} –{" "}
              {new Date(timing.ends_at).toLocaleString(uiLocale)}
            </p>
            <p>{timing.reason}</p>
          </>
        ) : (
          <p role="status">{uiText("Apro la versione citata…")}</p>
        )}
      </section>
    );
  return (
    <p role="status">
      {uiText("La fonte citata non è disponibile in questa vista.")}
    </p>
  );
}

export function ConsultationSources({
  entries,
  open,
}: {
  entries: ConsultationRef[];
  open: (r: ConsultationRef) => void;
}) {
  const { t: uiText } = useUiLanguage();
  function link(ref: ConsultationRef) {
    return (
      <button
        key={ref.kind + ref.id + ref.version}
        type="button"
        className="quiet source-link"
        onClick={() => open(ref)}
      >
        {ref.label}
      </button>
    );
  }
  if (!entries.length) return null;
  if (entries.length === 1) return link(entries[0]);
  return (
    <details>
      <summary>
        {entries.length}
        {uiText(" fonti")}
      </summary>
      {entries.map(link)}
    </details>
  );
}

type PrivateReadingProps = {
  actor: string;
  workspace: string;
  anchor?: string;
  open: (ref: ConsultationRef) => void;
  canShare: boolean;
  startId?: string;
};
export function PrivateWorkspaceReading(props: PrivateReadingProps) {
  return (
    <PrivateReadingView
      key={JSON.stringify([
        props.actor,
        props.workspace,
        props.startId,
        props.anchor,
      ])}
      {...props}
    />
  );
}
function PrivateReadingView({
  actor,
  workspace,
  anchor,
  open,
  canShare,
  startId,
}: PrivateReadingProps) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const path = "/api/v1/workspaces/" + workspace + "/consultation";
  const [previous, setPrevious] = useState<ConsultationReceipt | null>(null);
  const [turns, setTurns] = useState<ConsultationTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [lastRequest, setLastRequest] = useState<ConsultationInput | null>(
    null,
  );
  const alive = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    if (!anchor)
      void api<ConsultationReceipt | null>(
        path + "?kind=context",
        undefined,
        abort.signal,
      )
        .then((v) => {
          if (!abort.signal.aborted) setPrevious(v);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(errorText(e));
        });
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, [path, anchor]);
  async function run(input: ConsultationInput) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api<PrivateConsultation>(path, input);
      if (alive.current) {
        if (input.action === "share") {
          setTurns((current) =>
            current.map((turn) => (turn.id === value.id ? value : turn)),
          );
        } else {
          if (input.action === "resume")
            setTurns([...(value.history ?? []), value]);
          else
            setTurns((current) =>
              current.some((turn) => turn.id === value.id)
                ? current
                : [...current, value],
            );
          setPrevious({ id: value.id, createdAt: value.createdAt });
          if (input.action === "ask")
            setQuestion((current) =>
              current.trim() === input.question ? "" : current,
            );
        }
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      active.current = false;
      if (alive.current) setBusy(false);
    }
  }
  // The parent creates this ID only in a user click. Remounts replay the same
  // operation and never start an unsolicited recap on simply entering a space.
  useEffect(() => {
    if (anchor && startId) {
      const timer = setTimeout(() => {
        const input = {
          action: "summarize",
          kind: "recap",
          id: startId,
          expectedActorId: actor,
          anchorId: anchor,
        } as const;
        setLastRequest(input);
        void run(input);
      }, 0);
      return () => clearTimeout(timer);
    }
    // The component is keyed by actor, workspace and explicit request ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, anchor, startId, workspace]);
  function ask(value: string) {
    if (!value.trim()) return;
    const input = {
      action: "ask",
      kind: "context",
      id: crypto.randomUUID(),
      expectedActorId: actor,
      question: value.trim(),
      ...(turns.length ? { parentId: turns[turns.length - 1].id } : {}),
    } as const;
    setLastRequest(input);
    void run(input);
  }
  return (
    <section
      className="private-consultation"
      aria-label={
        anchor ? uiText("Riepilogo personale") : uiText("Consulta il contesto")
      }
    >
      {!anchor && (
        <>
          <h3>
            <EmmeMessageMark />
            {uiText(" Chiedi al contesto")}
          </h3>
          <p>
            {uiText(
              "Fai una domanda su questo spazio. La risposta è visibile solo a te.",
            )}
          </p>
          {!turns.length && (
            <div className="actions">
              {[
                uiText("Quali riferimenti abbiamo già accettato?"),
                uiText("Quali questioni sono ancora aperte?"),
              ].map((q) => (
                <button
                  type="button"
                  className="quiet"
                  key={q}
                  onClick={() => ask(q)}
                  disabled={busy}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {previous && !turns.length && (
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => {
                const input = {
                  action: "resume",
                  id: previous.id,
                  expectedActorId: actor,
                } as const;
                setLastRequest(input);
                void run(input);
              }}
            >
              {uiText("Riprendi l’ultima consultazione ·")}{" "}
              {new Date(previous.createdAt).toLocaleDateString(uiLocale)}
            </button>
          )}
        </>
      )}
      {busy && <p role="status">{uiText("Emme sta leggendo…")}</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          {lastRequest && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(lastRequest!)}
            >
              {uiText("Riprova")}
            </button>
          )}
        </p>
      )}
      {turns.map((result) => (
        <article
          key={result.id}
          aria-label={
            anchor
              ? uiText("Riepilogo personale")
              : uiText("Domanda e risposta")
          }
        >
          <small>
            {new Date(result.createdAt).toLocaleString(uiLocale)}
            {uiText(" · Solo tu")}
          </small>
          {!anchor && <h4>{result.question}</h4>}
          <p className="message-body emme-reply">{result.answer}</p>
          <ConsultationSources entries={result.references} open={open} />
          {!!result.personalIds.length && (
            <section>
              <h4>{uiText("Ti riguarda")}</h4>
              {result.personalIds.map((id, i) => (
                <button
                  type="button"
                  className="quiet"
                  key={id}
                  onClick={() =>
                    open({ kind: "source", id, version: 1, label: "Messaggio" })
                  }
                >
                  {uiText("Vai al messaggio ")}
                  {i + 1}
                </button>
              ))}
            </section>
          )}
          {result.sharedMessageId ? (
            <p role="status">{uiText("Condiviso nella chat dello spazio")}</p>
          ) : (
            canShare && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const input = {
                    action: "share",
                    id: result.id,
                    expectedActorId: actor,
                  } as const;
                  setLastRequest(input);
                  void run(input);
                }}
              >
                {uiText("Condividi in chat")}
              </button>
            )
          )}
        </article>
      ))}
      {!anchor && (
        <>
          {" "}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <label>
              {turns.length
                ? uiText("Continua la consultazione")
                : uiText("La tua domanda")}
              <input
                value={question}
                maxLength={2000}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            <button disabled={busy || !question.trim()}>
              {uiText("Chiedi a Emme")}
            </button>
          </form>
          {turns.length > 0 && (
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => {
                setTurns([]);
                setQuestion("");
                setError("");
                setLastRequest(null);
              }}
            >
              {uiText("Nuova consultazione")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
