"use client";
import { useEffect, useState } from "react";
import type { AttentionView } from "@/contracts/attention";
import type { Command } from "@/contracts/commands";
import { api } from "./api";
const modeLabels = {
  discreet: "Solo quando chiamata",
  collaborative: "Collaborativa",
  proactive: "Propositiva",
};
const changeLabels: Record<string, string> = {
  goal: "Goal",
  information: "Informazioni accettate",
  commitment: "Impegni",
  project: "Decisioni e vincoli",
  task: "Task",
  work: "Lavoro di Miriam",
  artifact: "Documenti",
  question: "Domande",
  workstream: "Filoni di lavoro",
};
export function WorkspaceAttention({
  workspace,
  actor,
  compact = false,
  open,
  command,
  action,
  busy,
  canContribute,
  name,
}: {
  workspace: string;
  actor: string;
  compact?: boolean;
  open: (panel: string) => void;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  canContribute: boolean;
  name: (id: string) => string;
}) {
  const [view, setView] = useState<AttentionView | null>(null),
    [error, setError] = useState(""),
    [before, setBefore] = useState<number | undefined>();
  const url = `/api/v1/workspaces/${workspace}/attention${before === undefined ? "" : `?before=${before}`}`;
  useEffect(() => {
    let active = true,
      running = false;
    const read = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const v = await api<AttentionView>(url);
        if (active) {
          setView(v);
          setError("");
        }
      } catch (e) {
        if (active) {
          setView(null);
          setError((e as Error).message);
        }
      } finally {
        running = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [url, actor]);
  const perform = (c: Command) =>
    action(async () => {
      await command(c);
      setView(await api<AttentionView>(url));
    });
  if (compact)
    return (
      <div className="attention-strip">
        <span>
          {error
            ? "Aggiornamento dello spazio non disponibile"
            : !view
              ? "Un momento…"
              : view.attention.length
                ? `${view.attention.length} ${view.attention.length === 1 ? "punto da seguire" : "punti da seguire"} · ${view.attention[0].reason}`
                : "Lo spazio è pronto per il prossimo passo."}
        </span>
        <button className="quiet" onClick={() => open("attention")}>
          Il punto adesso ↗
        </button>
      </div>
    );
  return (
    <section aria-label="Current State">
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          <p className="muted">
            Una vista di ciò che merita attenzione. Apri un elemento per il suo
            contenuto, le fonti e i controlli.
          </p>
          {view.attention.length === 0 && (
            <p>Nessuna domanda o attività richiede attenzione adesso.</p>
          )}
          {view.attention.map((item) => (
            <button
              className="attention-item"
              key={`${item.kind}:${item.id}`}
              onClick={() => {
                if (item.kind === "work") {
                  open("");
                  setTimeout(
                    () =>
                      document
                        .querySelector('[aria-label="Active Work"]')
                        ?.scrollIntoView({ block: "center" }),
                    0,
                  );
                } else
                  open(
                    item.kind === "task"
                      ? "work"
                      : item.kind === "artifact"
                        ? "artifacts"
                        : "context",
                  );
              }}
            >
              <small>{item.reason}</small>
              <strong>{item.text}</strong>
              <span aria-hidden>↗</span>
            </button>
          ))}
          <details open>
            <summary>Cosa è cambiato dal tuo ultimo allineamento</summary>
            <p className="hint">
              Il punto personale indica fino a dove hai ricostruito lo stato;
              non è consenso o accettazione delle decisioni.
            </p>
            {view.changes.length === 0 ? (
              <p className="muted">Nessun nuovo cambiamento strutturato.</p>
            ) : (
              view.changes.map((c) => (
                <div className="history-entry" key={c.revision}>
                  <strong>
                    {changeLabels[c.kind.split(".")[0]] ??
                      "Aggiornamento dello spazio"}
                  </strong>
                  <small>
                    {c.kind
                      .split(".")
                      .slice(1)
                      .join(" · ")
                      .replaceAll("_", " ")}{" "}
                    · {new Date(c.createdAt).toLocaleString("it-IT")}
                  </small>
                </div>
              ))
            )}
            {view.nextBefore !== null && (
              <button
                className="quiet"
                onClick={() => setBefore(view.nextBefore!)}
              >
                Cambiamenti precedenti
              </button>
            )}
            {before !== undefined ? (
              <button className="quiet" onClick={() => setBefore(undefined)}>
                Torna agli ultimi cambiamenti
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() =>
                  void perform({
                    type: "attention.aligned",
                    revision: view.revision,
                  })
                }
              >
                Sono allineato fino a qui
              </button>
            )}
          </details>
          <details>
            <summary>Il ritmo di Miriam</summary>
            <p className="hint">
              Regola quanto spesso proporre un contributo utile. Permessi,
              dissenso e limiti del lavoro restano invariati.
            </p>
            <label>
              Preferenza condivisa
              <select
                value={view.preference.mode}
                disabled={!canContribute || busy}
                onChange={(e) =>
                  void perform({
                    type: "attention.preference",
                    mode: e.target.value as AttentionView["preference"]["mode"],
                    expectedVersion: view.preference.version,
                  })
                }
              >
                {Object.entries(modeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {view.preference.actor && (
              <small>Scelta da {name(view.preference.actor)}</small>
            )}
          </details>
          <details>
            <summary>Filoni della conversazione</summary>
            <p className="hint">
              Organizzano temi senza creare chat separate o nuovi Goal. I
              messaggi originali restano al loro posto.
            </p>
            {view.workstreams.map((s) => (
              <details key={s.id}>
                <summary>
                  {s.title} · {s.sources.filter((x) => x.included).length} fonti
                </summary>
                <p>{s.description}</p>
                <small>
                  {s.origin === "miriam"
                    ? "Organizzazione proposta da Miriam"
                    : `Organizzato da ${name(s.actor!)}`}
                </small>
                {s.sources
                  .filter((x) => x.included)
                  .map((source) => (
                    <blockquote key={source.id}>
                      <p>{source.content}</p>
                      <small>
                        {source.kind === "message"
                          ? "Messaggio originale"
                          : "Fonte condivisa"}
                      </small>
                      {canContribute && (
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            void perform({
                              type: "workstream.link",
                              workstreamId: s.id,
                              sourceId: source.id,
                              expectedVersion: source.version,
                              included: false,
                            })
                          }
                        >
                          Togli da questo filone
                        </button>
                      )}
                    </blockquote>
                  ))}
                <details>
                  <summary>Storia del filone</summary>
                  {s.history.map((h) => (
                    <div className="history-entry" key={h.version}>
                      <strong>
                        v{h.version} · {h.title}
                      </strong>
                      <p>{h.description}</p>
                      <small>
                        {h.actor ? name(h.actor) : "Miriam"} ·{" "}
                        {new Date(h.createdAt).toLocaleString("it-IT")}
                      </small>
                    </div>
                  ))}
                </details>
                {canContribute && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void perform({
                        type: "workstream.save",
                        id: s.id,
                        expectedVersion: s.version,
                        title: String(f.get("title")),
                        description: String(f.get("description")),
                      });
                    }}
                  >
                    <label>
                      Nome
                      <input
                        name="title"
                        defaultValue={s.title}
                        required
                        maxLength={160}
                      />
                    </label>
                    <label>
                      Descrizione
                      <textarea
                        name="description"
                        defaultValue={s.description}
                        maxLength={4000}
                      />
                    </label>
                    <button disabled={busy}>Aggiorna filone</button>
                  </form>
                )}
              </details>
            ))}
            {canContribute && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = e.currentTarget;
                  void perform({
                    type: "workstream.save",
                    title: String(new FormData(f).get("title")),
                    description: "",
                  }).then(() => f.reset());
                }}
              >
                <label>
                  Un nuovo filone
                  <input
                    name="title"
                    required
                    maxLength={160}
                    placeholder="Per esempio: trovare il locale"
                  />
                </label>
                <button disabled={busy}>Crea filone</button>
              </form>
            )}
          </details>
        </>
      )}
    </section>
  );
}
