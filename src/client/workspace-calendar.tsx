"use client";
import { ProductHelp } from "./product-help";
import { useEffect, useState } from "react";
import { api } from "./api";
import { CommitmentTime } from "./commitment-time";
import { CalendarRevision } from "./calendar-revision";
import type { Command } from "@/contracts/commands";
import type { CalendarView, CalendarPayload } from "@/contracts/calendar";

const localDate = (value: string) =>
  new Date(
    new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
export function WorkspaceCalendar({
  workspace,
  revision,
  actor,
  command,
  action,
  busy,
}: {
  workspace: string;
  revision: number;
  actor: string;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [view, setView] = useState<CalendarView | null>(null),
    [error, setError] = useState("");
  const [start, setStart] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [editing, setEditing] = useState<
    CalendarView["temporal"][number] | null
  >(null);
  const [history, setHistory] = useState<unknown>(null);
  const [sourceObservation, setSourceObservation] = useState<string | null>(
    null,
  );
  const end = new Date(Date.parse(start) + 30 * 86400000).toISOString();
  const url = `/api/v1/workspaces/${workspace}/calendar?start=${encodeURIComponent(new Date(start).toISOString())}&end=${encodeURIComponent(end)}`;
  useEffect(() => {
    let live = true;
    void api<CalendarView>(url)
      .then((v) => {
        if (live) {
          setView(v);
          setError("");
        }
      })
      .catch((e) => {
        if (live) {
          setView(null);
          setError(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [url, revision, actor]);
  const current = view?.workspaceId === workspace ? view : null;
  const perform = (c: Command) =>
    action(async () => {
      await command(c);
      setView(await api<CalendarView>(url));
    });
  function payload(form: FormData): CalendarPayload {
    return {
      title: String(form.get("title")),
      start: new Date(String(form.get("start"))).toISOString(),
      end: new Date(String(form.get("end"))).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  return (
    <section className="card source-work" aria-label="Calendario dello spazio">
      <h2>Calendario</h2>
      <ProductHelp screen="calendar" />
      <p className="hint">
        Le proposte condividono con il Workspace il contenuto preciso, l’azione
        e il nome della risorsa esterna.
      </p>
      <p className="hint">
        Appuntamenti e impegni dello spazio. Un calendario esterno collegato non
        autorizza modifiche automatiche.
      </p>
      <label>
        Mostra 30 giorni dal
        <input
          type="date"
          value={start}
          onChange={(e) => {
            if (e.target.value) setStart(e.target.value);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {!current && !error && <p>Caricamento calendario…</p>}
      {current && (
        <>
          {!current.providerConfigured && (
            <p className="hint">
              Provider esterno non configurato. Gli appuntamenti interni sono
              disponibili; nessun risultato esterno viene simulato.
            </p>
          )}
          <details
            key={`${editing?.id ?? "new"}:${sourceObservation ?? "manual"}`}
            open={editing ? true : undefined}
          >
            <summary>
              {editing
                ? "Modifica appuntamento personale"
                : "Aggiungi appuntamento personale"}
            </summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void action(async () => {
                  const fields = {
                    payload:
                      sourceObservation && editing
                        ? editing.payload
                        : payload(form),
                    reason: String(form.get("reason")),
                    representSelf: true as const,
                    expectedContextRevision: current.contextRevision,
                  };
                  await command(
                    editing
                      ? {
                          type: "temporal.revise",
                          eventId: editing.id,
                          expectedVersion: editing.version,
                          ...(sourceObservation
                            ? {
                                sourceObservationId: sourceObservation,
                                shareObservedContent: true as const,
                              }
                            : {}),
                          ...fields,
                        }
                      : { type: "temporal.create", ...fields },
                  );
                  setEditing(null);
                  setSourceObservation(null);
                  setView(await api<CalendarView>(url));
                });
              }}
            >
              {sourceObservation && (
                <p>
                  Modifica proposta dall’osservazione selezionata. Salvando,
                  condividi questi dati precisi nello spazio e li stabilisci per
                  te. Il resto del calendario rimane riservato.
                </p>
              )}
              <label>
                Titolo appuntamento
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={editing?.payload.title}
                  readOnly={!!sourceObservation}
                />
              </label>
              <label>
                Inizio appuntamento
                <input
                  name="start"
                  type="datetime-local"
                  readOnly={!!sourceObservation}
                  required
                  defaultValue={
                    editing ? localDate(editing.payload.start) : undefined
                  }
                />
              </label>
              <label>
                Fine appuntamento
                <input
                  name="end"
                  type="datetime-local"
                  readOnly={!!sourceObservation}
                  required
                  defaultValue={
                    editing ? localDate(editing.payload.end) : undefined
                  }
                />
              </label>
              <label>
                Motivo appuntamento
                <input name="reason" required maxLength={2000} />
              </label>
              <label>
                <input type="checkbox" required />
                Rappresento soltanto me; non modifico impegni o vincoli di altre
                persone.
              </label>
              <button disabled={busy}>Salva appuntamento interno</button>
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setSourceObservation(null);
                  }}
                >
                  Annulla modifica
                </button>
              )}
            </form>
          </details>
          {!current.temporal.length && (
            <p>Nessun appuntamento interno in questo periodo.</p>
          )}
          <CommitmentTime view={current} perform={perform} busy={busy} />
          {current.temporal.map((t) => (
            <article className="source-work-item" key={`${t.kind}:${t.id}`}>
              <h3>{t.payload.title}</h3>
              <p>
                {t.kind === "commitment"
                  ? "Data dell’impegno"
                  : "Appuntamento personale"}{" "}
                · v{t.version} · {new Date(t.payload.start).toLocaleString()} →{" "}
                {new Date(t.payload.end).toLocaleString()} ({t.payload.timeZone}
                )
              </p>
              <p className="hint">
                {t.personId === actor
                  ? "Stabilito per te"
                  : "Stabilito per un altro partecipante"}{" "}
                · {t.reason}
              </p>
              {t.personId === actor && t.kind === "scheduled_event" && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditing(t);
                    setSourceObservation(null);
                  }}
                >
                  Modifica solo nello spazio
                </button>
              )}
              {t.personId === actor &&
                current.connections
                  .filter((c) => c.active)
                  .flatMap((c) =>
                    c.resources
                      .filter((r) => r.canWriteSelf)
                      .map((r) => {
                        const p = current.publications.find(
                          (p) =>
                            p.resourceId === r.id &&
                            p.temporal?.id === t.id &&
                            p.temporal.kind === t.kind,
                        );
                        return (
                          <button
                            disabled={busy}
                            key={r.id}
                            onClick={() =>
                              void perform({
                                type: "calendar.propose",
                                connectionId: c.id,
                                resourceId: r.id,
                                operation: p ? "update" : "create",
                                ...(p ? { publicationId: p.id } : {}),
                                temporal: {
                                  kind: t.kind,
                                  id: t.id,
                                  version: t.version,
                                },
                                payload: t.payload,
                                reason:
                                  "Pubblicazione proposta dall’appuntamento interno",
                                shareWithWorkspace: true,
                              })
                            }
                          >
                            {p
                              ? "Proponi aggiornamento"
                              : "Proponi pubblicazione"}{" "}
                            su {r.label}
                          </button>
                        );
                      }),
                  )}
            </article>
          ))}
          {current.actions.map((a) => (
            <article
              className="source-work-item"
              key={a.id}
              data-testid={`calendar-action-${a.id}`}
            >
              <h3>{a.payload.title}</h3>
              <p>
                {a.status} · proposta v{a.version}
              </p>
              <p>
                {a.operation === "create" ? "Creazione" : "Aggiornamento"} su{" "}
                {a.target}
              </p>
              <p>
                {new Date(a.payload.start).toLocaleString()} →{" "}
                {new Date(a.payload.end).toLocaleString()} ({a.payload.timeZone}
                )
              </p>
              <p>{a.reason}</p>
              <p className="hint">
                Rappresenta soltanto {a.personName}. Nessun invito, partecipante
                aggiunto o notifica esterna. Autorizzare consente al server di
                eseguire questa versione; non certifica il successo.
              </p>
              {a.status === "OUTCOME_UNKNOWN" && (
                <p role="status">
                  Il provider potrebbe avere già applicato l’azione. Verifica
                  l’esito prima di riprovare.
                </p>
              )}
              {a.error && <p>{a.error}</p>}
              <CalendarRevision
                view={current}
                action={a}
                actor={actor}
                perform={perform}
                busy={busy}
              />
              {a.canAuthorize && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "calendar.authorize",
                      actionId: a.id,
                      version: a.version,
                      expectedContextRevision: current.contextRevision,
                      expectedAccessRevision: current.accessRevision,
                      representSelf: true,
                    })
                  }
                >
                  Autorizzo questa azione per me
                </button>
              )}
              {a.canReject && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "calendar.reject",
                      actionId: a.id,
                      version: a.version,
                      reason:
                        "Rifiutata esplicitamente dalla persona rappresentata",
                    })
                  }
                >
                  Rifiuta proposta
                </button>
              )}
              {a.canRetry && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "calendar.retry",
                      actionId: a.id,
                      version: a.version,
                    })
                  }
                >
                  Riprova azione invariata
                </button>
              )}
              {a.canReconcile && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "calendar.reconcile",
                      actionId: a.id,
                      version: a.version,
                    })
                  }
                >
                  Verifica esito esterno
                </button>
              )}
              <button
                onClick={() =>
                  void action(async () =>
                    setHistory(
                      await api(
                        `/api/v1/workspaces/${workspace}/calendar-history?kind=action&id=${a.id}`,
                      ),
                    ),
                  )
                }
              >
                Storia e autorizzazioni
              </button>
            </article>
          ))}
          {current.nextActions && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const more = await api<CalendarView>(
                    `${url}&afterAction=${current.nextActions}`,
                  );
                  setView({
                    ...more,
                    actions: [...current.actions, ...more.actions],
                  });
                })
              }
            >
              Altre proposte Calendar
            </button>
          )}
          {current.connections
            .filter((c) => c.active)
            .map((c) => (
              <details key={c.id}>
                <summary>{c.label} · risorse personali autorizzate</summary>
                {c.resources
                  .filter((r) => r.canRead)
                  .map((r) => (
                    <div key={r.id}>
                      <p>{r.label}</p>
                      {(["events", "availability"] as const).map((mode) => (
                        <button
                          key={mode}
                          disabled={busy}
                          onClick={() =>
                            void perform({
                              type: "calendar.read",
                              connectionId: c.id,
                              resourceId: r.id,
                              mode,
                              start: new Date(start).toISOString(),
                              end,
                            })
                          }
                        >
                          {mode === "events"
                            ? "Leggi eventi del periodo"
                            : "Leggi disponibilità"}
                        </button>
                      ))}
                    </div>
                  ))}
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "calendar.disconnect",
                      connectionId: c.id,
                      expectedVersion: c.version,
                    })
                  }
                >
                  Disconnetti risorsa esterna
                </button>
              </details>
            ))}
          {current.observations.map((o) => (
            <details key={o.id}>
              <summary>
                Osservazione esterna riservata ·{" "}
                {new Date(o.observedAt).toLocaleString()}
              </summary>
              <p>
                Fonte esterna, non informazione accettata né impegno dello
                spazio.{" "}
                {o.data.complete
                  ? "Risposta completa per questa richiesta."
                  : "Risposta parziale: occorre altro contesto."}
              </p>
              {o.data.events.map((e) => {
                const p = current.publications.find(
                  (p) => p.resourceId === o.resourceId && p.externalId === e.id,
                );
                const t = current.temporal.find(
                  (t) =>
                    t.kind === "scheduled_event" &&
                    t.id === p?.temporal?.id &&
                    t.personId === actor,
                );
                return (
                  <div key={e.id}>
                    <p>
                      {e.payload.title} ·{" "}
                      {new Date(e.payload.start).toLocaleString()}
                      {e.deleted ? " · non più presente" : ""}
                    </p>
                    {t && !e.deleted && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing({ ...t, payload: e.payload });
                          setSourceObservation(o.id);
                        }}
                      >
                        Proponi modifica interna da questa osservazione
                      </button>
                    )}
                  </div>
                );
              })}
              {o.data.busy.map((b, i) => (
                <p key={i}>
                  Occupato: {new Date(b.start).toLocaleString()} →{" "}
                  {new Date(b.end).toLocaleString()}
                </p>
              ))}
              {o.data.nextCursor && (
                <button
                  disabled={busy}
                  onClick={() => {
                    const connection = current.connections.find((c) =>
                      c.resources.some((r) => r.id === o.resourceId),
                    );
                    if (
                      connection &&
                      (o.mode === "events" || o.mode === "availability")
                    )
                      void perform({
                        type: "calendar.read",
                        connectionId: connection.id,
                        resourceId: o.resourceId,
                        mode: o.mode,
                        start: o.start,
                        end: o.end,
                        cursor: o.data.nextCursor!,
                      });
                  }}
                >
                  Continua lettura
                </button>
              )}
            </details>
          ))}
          {current.reads
            .filter((r) => r.status !== "COMPLETED")
            .map((r) => (
              <p key={r.id}>
                Lettura esterna: {r.status} {r.error}
              </p>
            ))}
          {current.alerts.map((a, i) => (
            <p className="processing" key={`${a.first}:${a.second}:${i}`}>
              {a.detail}
            </p>
          ))}
          {history !== null && (
            <details open>
              <summary>Storia attribuita</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(history, null, 2)}
              </pre>
              <button onClick={() => setHistory(null)}>Chiudi storia</button>
            </details>
          )}
        </>
      )}
    </section>
  );
}
