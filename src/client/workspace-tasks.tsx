"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Command } from "@/contracts/commands";
import type {
  TasksView,
  TaskItem,
  TaskContent,
  WorkRef,
} from "@/contracts/tasks";
const empty: TaskContent = {
  title: "",
  description: "",
  dueAt: null,
  timeZone: "Europe/Rome",
  suggestedPerson: null,
  references: [],
};
export function WorkspaceTasks({
  workspace,
  actor,
  command,
  action,
  busy,
}: {
  workspace: string;
  actor: string;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false),
    [view, setView] = useState<TasksView | null>(null),
    [error, setError] = useState(""),
    [before, setBefore] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskItem | null>(null),
    [content, setContent] = useState(empty),
    [reason, setReason] = useState(""),
    [candidate, setCandidate] = useState<string | undefined>(),
    [history, setHistory] = useState<unknown>(null);
  const [follow, setFollow] = useState<TasksView["followups"][number] | null>(
      null,
    ),
    [reminder, setReminder] = useState(""),
    [at, setAt] = useState(""),
    [target, setTarget] = useState<WorkRef | null>(null);
  const url = `/api/v1/workspaces/${workspace}/tasks${before ? `?before=${before}` : ""}`;
  useEffect(() => {
    if (!open) return;
    let live = true,
      running = false;
    const read = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const v = await api<TasksView>(url);
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
  }, [url, actor, open]);
  const perform = (c: Command) =>
    action(async () => {
      await command(c);
      setView(await api<TasksView>(url));
    });
  const reset = () => {
    setEditing(null);
    setContent(empty);
    setCandidate(undefined);
    setReason("");
  };
  const name = (id: string | null) =>
    view?.members.find((m) => m.id === id)?.name ?? id ?? "Non assegnato";
  const base = (t: TaskItem) => ({
    taskId: t.id,
    expectedVersion: t.version,
    reason: reason || "Aggiornamento esplicito",
  });
  return (
    <section className="card source-work" aria-label="Tasks e follow-up">
      <button onClick={() => setOpen(!open)}>
        {open ? "Chiudi lavoro e follow-up" : "Lavoro e follow-up"}
      </button>
      {open && (
        <>
          <h2>Lavoro e follow-up</h2>
          <p>
            Registrare lavoro, assumersene la responsabilità e prendere un
            impegno sono atti distinti. I promemoria non autorizzano azioni.
          </p>
          {error && <p role="alert">{error}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await command(
                  editing
                    ? {
                        type: editing.responsible
                          ? "task.propose_revision"
                          : "task.revise",
                        ...base(editing),
                        content,
                      }
                    : {
                        type: "task.create",
                        content,
                        ...(candidate ? { candidateId: candidate } : {}),
                      },
                );
                reset();
                setView(await api<TasksView>(url));
              });
            }}
          >
            <h3>
              {editing ? "Modifica del lavoro" : "Nuovo Task non assegnato"}
            </h3>
            <label>
              Attività
              <input
                required
                value={content.title}
                onChange={(e) =>
                  setContent({ ...content, title: e.target.value })
                }
              />
            </label>
            <label>
              Perimetro e aspettative
              <textarea
                value={content.description}
                onChange={(e) =>
                  setContent({ ...content, description: e.target.value })
                }
              />
            </label>
            <label>
              Scadenza facoltativa
              <input
                type="datetime-local"
                value={
                  content.dueAt
                    ? new Date(
                        new Date(content.dueAt).getTime() -
                          new Date(content.dueAt).getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) =>
                  setContent({
                    ...content,
                    dueAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
              />
            </label>
            <label>
              Possibile referente — non assegnato
              <select
                value={content.suggestedPerson ?? ""}
                onChange={(e) =>
                  setContent({
                    ...content,
                    suggestedPerson: e.target.value || null,
                  })
                }
              >
                <option value="">Nessuno</option>
                {view?.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Motivo della modifica
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required={!!editing}
              />
            </label>
            {content.references.map((r) => (
              <p key={`${r.kind}${r.id}`}>
                Riferimento {r.kind}: {r.id} · v{r.version}
              </p>
            ))}
            <button disabled={busy}>
              {editing?.responsible
                ? "Proponi modifica da accettare"
                : editing
                  ? "Salva modifica"
                  : "Registra Task"}
            </button>
            {editing && (
              <button type="button" onClick={reset}>
                Annulla modifica
              </button>
            )}
          </form>
          {!!view?.suggestions.length && (
            <details>
              <summary>Proposte da Miriam — non sono Task</summary>
              {view.suggestions.map((s) => (
                <article key={s.id}>
                  <p>{s.content}</p>
                  <small>
                    {s.origin} · {s.qualification}
                  </small>
                  <button
                    onClick={() => {
                      reset();
                      setContent({
                        ...empty,
                        title: s.subject,
                        description: s.content,
                      });
                      setCandidate(s.id);
                    }}
                  >
                    Prepara un Task da questa proposta
                  </button>
                </article>
              ))}
            </details>
          )}
          {view?.tasks.map((t) => (
            <article className="source-work-item" key={t.id}>
              <h3>{t.title}</h3>
              <p>{t.description}</p>
              <p>
                {t.status} · v{t.version} ·{" "}
                {t.dueAt
                  ? new Date(t.dueAt).toLocaleString()
                  : "Senza scadenza"}
              </p>
              <p>
                Responsabilità: {name(t.responsible)}
                {t.responsible
                  ? ` · accettata su v${t.acceptedVersion}${t.responsibleAvailable ? "" : " · accesso non disponibile"}`
                  : ""}
              </p>
              {t.suggestedPerson && (
                <p>
                  Referente suggerito: {name(t.suggestedPerson)} — nessuna
                  assegnazione implicita.
                </p>
              )}
              <small>
                {name(t.actor)} · {t.reason}
                {t.candidateId ? " · origine: proposta Miriam" : ""}
              </small>
              {t.references.map((r) => (
                <p key={`${r.kind}${r.id}`}>
                  {r.kind} · {r.id} · v{r.version}
                  {r.kind === "commitment"
                    ? " — obbligo separato, non modificato dal Task"
                    : ""}
                </p>
              ))}
              {!t.responsible &&
                !["completed", "cancelled"].includes(t.status) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform({
                        type: "task.accept",
                        ...base(t),
                        representSelf: true,
                      })
                    }
                  >
                    Me ne occupo
                  </button>
                )}
              {t.responsible === actor && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "task.relinquish",
                      ...base(t),
                      representSelf: true,
                    })
                  }
                >
                  Lascio la responsabilità
                </button>
              )}
              {(!t.responsible || t.responsible === actor) && (
                <>
                  <button
                    disabled={busy || t.status === "completed"}
                    onClick={() =>
                      void perform({
                        type: "task.status",
                        ...base(t),
                        status: "completed",
                        noNormativeEffect: true,
                      })
                    }
                  >
                    Segna completato — solo Task
                  </button>
                  <button
                    disabled={busy || t.status === "cancelled"}
                    onClick={() =>
                      void perform({
                        type: "task.status",
                        ...base(t),
                        status: "cancelled",
                        noNormativeEffect: true,
                      })
                    }
                  >
                    Annulla Task — conserva obblighi
                  </button>
                </>
              )}
              {!["completed", "cancelled"].includes(t.status) && (
                <button
                  onClick={() => {
                    setEditing(t);
                    setContent(t);
                    setCandidate(undefined);
                  }}
                >
                  Modifica / proponi
                </button>
              )}
              <button
                onClick={() => {
                  setTarget({ kind: "task", id: t.id, version: t.version });
                  setReminder(`Verificare: ${t.title}`);
                }}
              >
                Prepara follow-up
              </button>
              <button
                onClick={() =>
                  void action(async () =>
                    setHistory(
                      await api(
                        `/api/v1/workspaces/${workspace}/tasks-history?id=${t.id}&kind=task`,
                      ),
                    ),
                  )
                }
              >
                Storia Task
              </button>
              {view.proposals
                .filter((p) => p.taskId === t.id)
                .map((p) => (
                  <div key={p.id}>
                    <p>
                      Proposta di {name(p.actor)}: {p.content.title} ·{" "}
                      {p.content.dueAt ?? "senza scadenza"}
                    </p>
                    <p>{p.content.description}</p>
                    {t.responsible === actor && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform({
                            type: "task.adopt_revision",
                            ...base(t),
                            proposalId: p.id,
                            acceptResponsibility: true,
                          })
                        }
                      >
                        Accetto il nuovo perimetro
                      </button>
                    )}
                  </div>
                ))}
            </article>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = {
                content: reminder,
                kind: "check" as const,
                remindAt: new Date(at).toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                reference: target,
              };
              void perform(
                follow
                  ? {
                      type: "followup.revise",
                      followupId: follow.id,
                      expectedVersion: follow.version,
                      reason: "Revisione esplicita del follow-up",
                      ...value,
                    }
                  : { type: "followup.create", ...value },
              );
              setFollow(null);
              setReminder("");
              setAt("");
              setTarget(null);
            }}
          >
            <h3>{follow ? "Rivedi follow-up" : "Nuovo follow-up per me"}</h3>
            <label>
              Cosa ricordare / verificare
              <input
                required
                value={reminder}
                onChange={(e) => setReminder(e.target.value)}
              />
            </label>
            <label>
              Quando
              <input
                required
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </label>
            <p>
              {target
                ? `Riferimento ${target.kind} · ${target.id} · v${target.version}`
                : "Follow-up indipendente"}
            </p>
            <button disabled={busy}>Salva follow-up</button>
          </form>
          {view?.followups.map((f) => (
            <article className="source-work-item" key={f.id}>
              <h3>{f.content}</h3>
              <p>
                {name(f.owner)} · {f.status} · v{f.version} ·{" "}
                {new Date(f.remindAt).toLocaleString()}
              </p>
              <p>
                {f.needsReview
                  ? "Da rivedere: accesso o riferimento cambiato"
                  : f.deliveredAt
                    ? "Promemoria disponibile — nessuna azione eseguita"
                    : "In attesa"}
              </p>
              {f.owner === actor && (
                <>
                  <button
                    onClick={() => {
                      setFollow(f);
                      setReminder(f.content);
                      setAt("");
                      setTarget(
                        f.reference?.kind === "task"
                          ? {
                              ...f.reference,
                              version:
                                view.tasks.find((t) => t.id === f.reference?.id)
                                  ?.version ?? f.reference.version,
                            }
                          : f.reference,
                      );
                    }}
                  >
                    Rivedi / riprogramma
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform({
                        type: "followup.close",
                        followupId: f.id,
                        expectedVersion: f.version,
                        reason: "Verifica terminata",
                        status: "done",
                      })
                    }
                  >
                    Verifica fatta
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform({
                        type: "followup.close",
                        followupId: f.id,
                        expectedVersion: f.version,
                        reason: "Non serve più",
                        status: "cancelled",
                      })
                    }
                  >
                    Annulla follow-up
                  </button>
                </>
              )}
              <button
                onClick={() =>
                  void action(async () =>
                    setHistory(
                      await api(
                        `/api/v1/workspaces/${workspace}/tasks-history?id=${f.id}&kind=followup`,
                      ),
                    ),
                  )
                }
              >
                Storia follow-up
              </button>
            </article>
          ))}
          {view?.next && (
            <button onClick={() => setBefore(view.next)}>Altri elementi</button>
          )}
          {before && (
            <button onClick={() => setBefore(null)}>
              Torna ai primi elementi
            </button>
          )}
          {history !== null && (
            <details open>
              <summary>Storia e provenance</summary>
              <pre>{JSON.stringify(history, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
