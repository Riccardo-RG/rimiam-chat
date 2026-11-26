"use client";
import { useUiLanguage } from "./ui-language";

import { workstreamDescription } from "@/shared/assistant-presentation";
import { ProductHelp } from "./product-help";
import { useEffect, useState, type ReactNode } from "react";
import type { AttentionView } from "@/contracts/attention";
import type { Command } from "@/contracts/commands";
import { api, errorText } from "./api";
import {
  collaborationModeLabels as modeLabels,
  collaborationModeDescriptions,
  attentionReasonLabel,
  workspaceChangeLabel,
} from "../shared/workspace-labels";
export type CompactAttention = { count: number; unavailable: boolean };

function TopicEditor({
  topic,
  busy,
  perform,
}: {
  topic: AttentionView["workstreams"][number];
  busy: boolean;
  perform: (command: Command) => Promise<boolean>;
}) {
  const { t: uiText } = useUiLanguage();
  const [draft, setDraft] = useState<Pick<
    typeof topic,
    "version" | "title" | "description"
  > | null>(null);
  const snapshot = () => ({
    version: topic.version,
    title: topic.title,
    description: topic.description,
  });
  const stale = draft !== null && draft.version !== topic.version;
  return (
    <details
      onToggle={(e) => {
        const open = e.currentTarget.open;
        setDraft((current) => (open ? (current ?? snapshot()) : null));
      }}
    >
      <summary>{uiText("Modifica l’argomento")}</summary>
      {draft && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (stale || busy) return;
            const details = e.currentTarget.closest("details");
            if (
              (await perform({
                type: "workstream.save",
                id: topic.id,
                expectedVersion: draft.version,
                title: draft.title,
                description: draft.description,
              })) &&
              details
            )
              details.open = false;
          }}
        >
          <label>
            {uiText("Nome")}
            <input
              name="title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
              maxLength={160}
            />
          </label>
          <label>
            {uiText("Descrizione")}
            <textarea
              name="description"
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              maxLength={4000}
            />
          </label>
          {stale && (
            <div role="status">
              <p>
                {uiText(
                  "L’argomento è cambiato mentre scrivevi. Ora nello spazio:",
                )}
              </p>
              <strong>{topic.title}</strong>
              <p>{topic.description}</p>
              <button
                type="button"
                className="quiet"
                onClick={() => setDraft(snapshot())}
              >
                {uiText("Usa il testo aggiornato")}
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => setDraft({ ...draft, version: topic.version })}
              >
                {uiText("Continua con la mia modifica")}
              </button>
            </div>
          )}
          <button disabled={busy || stale}>
            {uiText("Aggiorna argomento")}
          </button>
        </form>
      )}
    </details>
  );
}

export function WorkspaceAttention({
  workspace,
  actor,
  compact = false,
  renderSummary,
  open,
  command,
  action,
  busy,
  canContribute,
  name,
  focus,
  onWorkstreams,
  showChanges = true,
}: {
  workspace: string;
  actor: string;
  compact?: boolean;
  renderSummary?: (attention: CompactAttention) => ReactNode;
  open: (panel: string) => void;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  canContribute: boolean;
  name: (id: string) => string;
  focus?: (stream: AttentionView["workstreams"][number]) => void;
  onWorkstreams?: (streams: AttentionView["workstreams"]) => void;
  showChanges?: boolean;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [view, setView] = useState<AttentionView | null>(null),
    [showInactive, setShowInactive] = useState(false),
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
          onWorkstreams?.(v.workstreams);
          setError("");
        }
      } catch (e) {
        if (active) {
          setView(null);
          setError(errorText(e));
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
  }, [url, actor, onWorkstreams]);
  const perform = async (c: Command) => {
    let committed = false;
    await action(async () => {
      await command(c);
      committed = true;
      try {
        const next = await api<AttentionView>(url);
        setView(next);
        onWorkstreams?.(next.workstreams);
      } catch {
        setError(
          uiText(
            "Modifica salvata. La schermata si aggiornerà appena possibile.",
          ),
        );
      }
    });
    return committed;
  };
  // Work already has its own header entry. Keep the general attention link for
  // other items such as a question or a pending decision.
  const otherAttention = view?.attention.filter((item) => item.kind !== "work");
  if (compact && renderSummary)
    return renderSummary({
      count: otherAttention?.length ?? 0,
      unavailable: Boolean(error),
    });
  if (compact && !error && !otherAttention?.length) return null;
  if (compact)
    return (
      <div className="activity-entry">
        <button
          className="quiet"
          onClick={() => open("attention")}
          aria-label={uiText("Apri attività e argomenti")}
        >
          {uiText("Attività")}{" "}
          {otherAttention?.length
            ? uiText("· {0} da seguire", String(otherAttention.length))
            : "↗"}
        </button>
        {error && (
          <small role="status">{uiText("Aggiornamento non disponibile")}</small>
        )}
      </div>
    );
  return (
    <section
      className="workspace-attention"
      aria-label={uiText("Current State")}
    >
      {!view && !error && (
        <p role="status">{uiText("Caricamento delle attività…")}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          <details className="activity-group">
            <summary>
              <span>
                <strong>
                  {uiText("Da seguire · ")}
                  {view.attention.length}
                </strong>
                <small>
                  {uiText("Domande e attività che richiedono attenzione.")}
                </small>
              </span>
            </summary>
            {view.attention.length === 0 && (
              <p className="hint">{uiText("Tutto in ordine.")}</p>
            )}
            {view.attention.map((item) => (
              <button
                className="attention-item"
                key={`${item.kind}:${item.id}`}
                onClick={() => {
                  if (item.kind === "work") {
                    open("work");
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
                <small>{uiText(attentionReasonLabel(item.reason))}</small>
                <strong>{item.text}</strong>
                <span aria-hidden>↗</span>
              </button>
            ))}
          </details>
          {showChanges && (
            <details>
              <summary>
                {uiText("Cosa è cambiato dal tuo ultimo allineamento")}
              </summary>
              <p className="hint">
                {uiText(
                  "Il punto personale indica fino a dove hai ricostruito lo stato; non è consenso o accettazione delle decisioni.",
                )}
              </p>
              {view.changes.length === 0 ? (
                <p className="muted">
                  {uiText("Nessun nuovo cambiamento strutturato.")}
                </p>
              ) : (
                view.changes.map((c) => (
                  <div className="history-entry" key={c.revision}>
                    <strong>{uiText(workspaceChangeLabel(c.kind))}</strong>
                    <small>
                      {new Date(c.createdAt).toLocaleString(uiLocale)}
                    </small>
                  </div>
                ))
              )}
              {view.nextBefore !== null && (
                <button
                  className="quiet"
                  onClick={() => setBefore(view.nextBefore!)}
                >
                  {uiText("Cambiamenti precedenti")}
                </button>
              )}
              {before !== undefined ? (
                <button className="quiet" onClick={() => setBefore(undefined)}>
                  {uiText("Torna agli ultimi cambiamenti")}
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
                  {uiText("Sono allineato fino a qui")}
                </button>
              )}
            </details>
          )}
          <details className="activity-group">
            <summary>
              <span>
                <strong>{uiText("Argomenti della conversazione")}</strong>
                <small>
                  {uiText("Ritrova i messaggi che parlano dello stesso tema.")}
                </small>
              </span>
            </summary>
            <label>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              {uiText(
                "Mostra anche gli argomenti proposti, conclusi e archiviati",
              )}
            </label>
            {view.workstreams
              .filter((s) => showInactive || s.state === "active")
              .map((s) => (
                <details key={s.id}>
                  <summary>
                    {s.title} ·{" "}
                    {uiText(
                      {
                        active: "Attivo",
                        proposed: "Proposto",
                        resolved: "Risolto",
                        archived: "Archiviato",
                      }[s.state],
                    )}{" "}
                    · {s.sources.filter((x) => x.included).length}
                    {uiText(" fonti")}
                  </summary>
                  <p>{workstreamDescription(s.origin, s.description)}</p>
                  {focus && (
                    <button className="quiet" onClick={() => focus(s)}>
                      {uiText("Apri la conversazione di questo argomento")}
                    </button>
                  )}
                  {canContribute && (
                    <div className="actions">
                      {(s.state === "proposed"
                        ? ["activate", "archive"]
                        : s.state === "active"
                          ? ["resolve", "archive"]
                          : s.state === "resolved"
                            ? ["reopen", "archive"]
                            : ["restore"]
                      ).map((transition) => (
                        <button
                          key={transition}
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            void perform({
                              type: "workstream.transition",
                              workstreamId: s.id,
                              expectedVersion: s.version,
                              action: transition as
                                | "activate"
                                | "resolve"
                                | "archive"
                                | "reopen"
                                | "restore",
                            })
                          }
                        >
                          {uiText(
                            {
                              activate: "Attiva argomento",
                              resolve: "Segna come risolto",
                              archive: "Archivia argomento",
                              reopen: "Riapri argomento",
                              restore: "Ripristina argomento",
                            }[transition] ?? "",
                          ) || transition}
                        </button>
                      ))}
                    </div>
                  )}
                  <small>
                    {s.origin === "miriam"
                      ? uiText("Organizzazione proposta da Emme")
                      : uiText("Organizzato da {0}", String(name(s.actor!)))}
                  </small>
                  {s.sources.some((source) => source.included) && (
                    <details>
                      <summary>{uiText("Messaggi e fonti collegati")}</summary>
                      {s.sources
                        .filter((x) => x.included)
                        .map((source) => (
                          <blockquote key={source.id}>
                            <p>{source.content}</p>
                            <small>
                              {source.kind === "message"
                                ? uiText("Messaggio originale")
                                : uiText("Fonte condivisa")}
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
                                {uiText("Togli da questo argomento")}
                              </button>
                            )}
                          </blockquote>
                        ))}
                    </details>
                  )}
                  <details>
                    <summary>{uiText("Storia dell’argomento")}</summary>
                    {s.history.map((h) => (
                      <div className="history-entry" key={h.version}>
                        <strong>
                          {uiText("v")}
                          {h.version} · {h.title}
                        </strong>
                        <p>{h.description}</p>
                        {h.lifecycleState && (
                          <small>
                            {uiText(
                              {
                                active: "Attivo",
                                archived: "Archiviato",
                                proposed: "Proposto",
                                resolved: "Concluso",
                              }[h.lifecycleState],
                            )}
                          </small>
                        )}
                        <small>
                          {h.actor ? name(h.actor) : uiText("Emme")} ·{" "}
                          {new Date(h.createdAt).toLocaleString(uiLocale)}
                        </small>
                      </div>
                    ))}
                  </details>
                  {canContribute && s.state !== "archived" && (
                    <TopicEditor topic={s} busy={busy} perform={perform} />
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
                  }).then((committed) => {
                    if (committed) f.reset();
                  });
                }}
              >
                <label>
                  {uiText("Un nuovo argomento")}
                  <input
                    name="title"
                    required
                    maxLength={160}
                    placeholder={uiText("Per esempio: preparare la beta")}
                  />
                </label>
                <button disabled={busy}>{uiText("Crea argomento")}</button>
              </form>
            )}
          </details>
          <details className="activity-group">
            <summary>
              <span>
                <strong>{uiText("Il ritmo di Emme")}</strong>
                <small>{uiText(modeLabels[view.preference.mode])}</small>
              </span>
            </summary>
            <label>
              {uiText("Preferenza condivisa")}
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
                    {uiText(label)}
                  </option>
                ))}
              </select>
            </label>
            <p>{uiText(collaborationModeDescriptions[view.preference.mode])}</p>
            {view.preference.actor && (
              <small>
                {uiText("Scelta da ")}
                {name(view.preference.actor)}
              </small>
            )}
          </details>
        </>
      )}
      <ProductHelp screen="workstreams" />
    </section>
  );
}
