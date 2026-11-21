"use client";
import { useUiLanguage } from "./ui-language";

import { CalendarAudienceFields, audienceFromForm } from "./calendar-audience";
import { IntegrationConnections } from "./mailbox-connections";
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
  personal = false,
  canConnect = true,
  initialDay,
}: {
  workspace: string;
  revision: number;
  actor: string;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  personal?: boolean;
  canConnect?: boolean;
  initialDay?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const [view, setView] = useState<CalendarView | null>(null),
    [error, setError] = useState("");
  const [start, setStart] = useState(
    () => initialDay || localDate(new Date().toISOString()).slice(0, 10),
  );
  const [editing, setEditing] = useState<
    CalendarView["temporal"][number] | null
  >(null);
  const [history, setHistory] = useState<unknown>(null);
  const [sourceObservation, setSourceObservation] = useState<string | null>(
    null,
  );
  const firstDay = new Date(start + "T00:00:00");
  const lastDay = new Date(firstDay);
  lastDay.setDate(lastDay.getDate() + 30);
  const windowStart = firstDay.toISOString(),
    end = lastDay.toISOString();
  const url = `/api/v1/workspaces/${workspace}/calendar?start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(end)}`;
  const [refresh, setRefresh] = useState(0);
  const hasPendingRead = view?.reads.some(
    (r) => r.status === "QUEUED" || r.status === "READING",
  );
  useEffect(() => {
    function returned() {
      if (!document.hidden) setRefresh((n) => n + 1);
    }
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", returned);
    const timer = hasPendingRead
      ? window.setInterval(returned, 3000)
      : undefined;
    return () => {
      window.removeEventListener("focus", returned);
      document.removeEventListener("visibilitychange", returned);
      window.clearInterval(timer);
    };
  }, [hasPendingRead]);
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
  }, [url, revision, actor, refresh]);
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
    <section
      className="card source-work"
      aria-label={
        personal
          ? uiText("Calendari personali")
          : uiText("Calendario dello spazio")
      }
    >
      {current && (
        <IntegrationConnections
          capability="calendar"
          canConnect={canConnect}
          workspace={workspace}
          connections={current.connections}
        />
      )}
      {!personal && (
        <p className="hint">
          {uiText(
            "Le proposte di pubblicazione rendono visibili nello spazio evento, operazione e calendario di destinazione.",
          )}
        </p>
      )}
      <label>
        {uiText("Mostra 30 giorni dal")}
        <input
          type="date"
          value={start}
          onChange={(e) => {
            if (e.target.value) setStart(e.target.value);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {!current && !error && <p>{uiText("Caricamento calendario…")}</p>}
      {current && (
        <>
          {!personal && (
            <>
              <details
                key={`${editing?.id ?? "new"}:${sourceObservation ?? "manual"}`}
                open={editing ? true : undefined}
              >
                <summary>
                  {editing
                    ? uiText("Modifica appuntamento personale")
                    : uiText("Aggiungi appuntamento personale")}
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
                        ...(!sourceObservation
                          ? { audience: audienceFromForm(form) }
                          : {}),
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
                      {uiText(
                        "Salvando, confermi questi dati per te e li condividi nello spazio. Il resto del tuo calendario rimane privato.",
                      )}
                    </p>
                  )}
                  <label>
                    {uiText("Titolo appuntamento")}
                    <input
                      name="title"
                      required
                      maxLength={200}
                      defaultValue={editing?.payload.title}
                      readOnly={!!sourceObservation}
                    />
                  </label>
                  <label>
                    {uiText("Inizio appuntamento")}
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
                    {uiText("Fine appuntamento")}
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
                  {!sourceObservation && (
                    <CalendarAudienceFields
                      members={current.members}
                      initial={editing?.audience}
                    />
                  )}
                  <label>
                    {uiText("Motivo appuntamento")}
                    <input name="reason" required maxLength={2000} />
                  </label>
                  <label>
                    <input type="checkbox" required />
                    {uiText(
                      "Rappresento soltanto me; non modifico impegni o vincoli di altre persone.",
                    )}
                  </label>
                  <button disabled={busy}>
                    {uiText("Salva appuntamento interno")}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setSourceObservation(null);
                      }}
                    >
                      {uiText("Annulla modifica")}
                    </button>
                  )}
                </form>
              </details>
              {!current.temporal.length && (
                <p>
                  {uiText("Nessun appuntamento interno in questo periodo.")}
                </p>
              )}
              <CommitmentTime view={current} perform={perform} busy={busy} />
              {current.temporal.map((t) => (
                <article className="source-work-item" key={`${t.kind}:${t.id}`}>
                  <h3>{t.payload.title}</h3>
                  <p>
                    {t.kind === "commitment"
                      ? uiText("Data dell’impegno")
                      : uiText("Appuntamento personale")}{" "}
                    {uiText("· v")}
                    {t.version} · {new Date(t.payload.start).toLocaleString()} →{" "}
                    {new Date(t.payload.end).toLocaleString()} (
                    {t.payload.timeZone})
                  </p>
                  <p className="hint">
                    {t.personId === actor
                      ? uiText("Stabilito per te")
                      : uiText("Stabilito per un altro partecipante")}{" "}
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
                      {uiText("Modifica solo nello spazio")}
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
                                  ? uiText("Proponi aggiornamento")
                                  : uiText("Proponi pubblicazione")}{" "}
                                {uiText("su ")}
                                {r.label}
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
                    {a.status}
                    {uiText(" · proposta v")}
                    {a.version}
                  </p>
                  <p>
                    {a.operation === "create"
                      ? uiText("Creazione")
                      : uiText("Aggiornamento")}{" "}
                    {uiText("su ")}
                    {a.target}
                  </p>
                  <p>
                    {new Date(a.payload.start).toLocaleString()} →{" "}
                    {new Date(a.payload.end).toLocaleString()} (
                    {a.payload.timeZone})
                  </p>
                  <p>{a.reason}</p>
                  <p className="hint">
                    {uiText("Rappresenta soltanto ")}
                    {a.personName}
                    {uiText(
                      ". Nessun invito, partecipante aggiunto o notifica esterna. Autorizzare consente al server di eseguire questa versione; non certifica il successo.",
                    )}
                  </p>
                  {a.status === "OUTCOME_UNKNOWN" && (
                    <p role="status">
                      {uiText(
                        "Il provider potrebbe avere già applicato l’azione. Verifica l’esito prima di riprovare.",
                      )}
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
                      {uiText("Autorizzo questa azione per me")}
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
                      {uiText("Rifiuta proposta")}
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
                      {uiText("Riprova azione invariata")}
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
                      {uiText("Verifica sul calendario collegato")}
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
                    {uiText("Storia e autorizzazioni")}
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
                  {uiText("Altre proposte Calendar")}
                </button>
              )}
            </>
          )}
          {current.connections
            .filter((c) => c.active)
            .map((c) => (
              <details key={c.id} open={c.active || undefined}>
                <summary>{c.label}</summary>
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
                              start: windowStart,
                              end,
                            })
                          }
                        >
                          {mode === "events"
                            ? uiText("Sincronizza eventi")
                            : uiText("Solo disponibilità")}
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
                  {uiText("Scollega calendario")}
                </button>
              </details>
            ))}
          {current.observations.map((o, i) => (
            <details
              key={o.id}
              open={(o.mode !== "reconcile" && i === 0) || undefined}
            >
              <summary>
                {o.mode === "reconcile"
                  ? uiText("Osservazione esterna riservata")
                  : i === 0
                    ? uiText("Ultima sincronizzazione")
                    : uiText("Sincronizzazione precedente")}{" "}
                · {new Date(o.observedAt).toLocaleString()}
              </summary>
              <p>
                {uiText(
                  "Fonte esterna, non informazione accettata né impegno dello spazio.",
                )}{" "}
                {o.data.complete
                  ? uiText("Risposta completa per questa richiesta.")
                  : uiText("Risposta parziale: occorre altro contesto.")}
              </p>
              {!o.data.events.length &&
                !o.data.busy.length &&
                o.data.complete && (
                  <p>{uiText("Nessun evento in questa lettura.")}</p>
                )}
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
                      {e.deleted ? uiText(" · non più presente") : ""}
                    </p>
                    {!personal && t && !e.deleted && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing({ ...t, payload: e.payload });
                          setSourceObservation(o.id);
                        }}
                      >
                        {uiText(
                          "Proponi modifica interna da questa osservazione",
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
              {o.data.busy.map((b, i) => (
                <p key={i}>
                  {uiText("Occupato: ")}
                  {new Date(b.start).toLocaleString()} →{" "}
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
                  {uiText("Continua lettura")}
                </button>
              )}
            </details>
          ))}
          {current.reads
            .filter((r) => r.status !== "COMPLETED")
            .map((r) => (
              <p key={r.id}>
                {r.status === "QUEUED" || r.status === "READING"
                  ? uiText("Sincronizzazione in corso…")
                  : uiText(
                      "Sincronizzazione non riuscita. Riprova dalla risorsa collegata.",
                    )}
              </p>
            ))}
          {current.alerts.map((a, i) => (
            <p className="processing" key={`${a.first}:${a.second}:${i}`}>
              {a.detail}
            </p>
          ))}
          {history !== null && (
            <details open>
              <summary>{uiText("Storia attribuita")}</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(history, null, 2)}
              </pre>
              <button onClick={() => setHistory(null)}>
                {uiText("Chiudi storia")}
              </button>
            </details>
          )}
        </>
      )}
      {!personal && <ProductHelp screen="calendar" />}
    </section>
  );
}
