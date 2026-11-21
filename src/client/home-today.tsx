"use client";
import { localizedDate } from "../shared/i18n/date";
import { useUiLanguage } from "./ui-language";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";
import dynamic from "next/dynamic";
import type { z } from "zod";
import {
  agendaDestinationSchema,
  agendaViewSchema,
  type AgendaView,
} from "../contracts/agenda";
import type { Command } from "../contracts/commands";
import { personalSpaceResultSchema } from "../contracts/v1";
import { CalendarAudienceFields, audienceFromForm } from "./calendar-audience";
import { calendarConnectionLabel } from "./calendar-connection-label";
import { WorkspaceIcon } from "./workspace-icon";
import { api, errorText } from "./api";
import {
  newCommand,
  sendCommand,
  type PendingCommand,
} from "./command-journal";
import { ReminderRepeatFields, once, repeatRule } from "./reminder-repeat";
import styles from "./home-today.module.css";

const PersonalCalendar = dynamic(() =>
  import("./workspace-calendar").then((m) => m.WorkspaceCalendar),
);
const clock = localizedDate({
  hour: "2-digit",
  minute: "2-digit",
});
const weekday = localizedDate({ weekday: "long" });
function returnedFromCalendarConsent() {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("calendars") === "1"
  );
}
function localField(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
type Item = AgendaView["items"][number];
type Editor = "event" | "reminder";

export type HomeTodayHandle = {
  openToday: () => void;
  openCalendars: () => void;
};

export function HomeToday({
  ref,
  actor,
  spaces,
  calendarLinked,
  onCalendarLinked,
}: {
  ref?: Ref<HomeTodayHandle>;
  actor: string;
  spaces: { id: string; name: string }[];
  calendarLinked: boolean | null;
  onCalendarLinked: (linked: boolean | null) => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [day, setDay] = useState(""),
    [today, setToday] = useState(""),
    [expanded, setExpanded] = useState(() => {
      if (typeof window === "undefined") return true;
      try {
        return localStorage.getItem("rimiam:today:" + actor) !== "closed";
      } catch {
        return true;
      }
    }),
    [calendar, setCalendar] = useState(false);
  const [external, setExternal] = useState(returnedFromCalendarConsent);
  const [archive, setArchive] = useState("");
  const [archiveAttempt, setArchiveAttempt] = useState(0);
  const [archiveError, setArchiveError] = useState("");
  useEffect(() => {
    if (!external || archive) return;
    const controller = new AbortController();
    void api<unknown>(
      "/api/v1/personal-space",
      { expectedActorId: actor },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted)
          setArchive(personalSpaceResultSchema.parse(value).id);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setArchiveError(errorText(e));
      });
    return () => controller.abort();
  }, [external, archive, actor, archiveAttempt]);
  const [view, setView] = useState<AgendaView | null>(null),
    [revision, refresh] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<Editor | null>(null),
    [edit, setEdit] = useState<Item | null>(null),
    [destination, setDestination] = useState(""),
    [repeat, setRepeat] = useState(once);
  const [configuration, setConfiguration] = useState<z.infer<
    typeof agendaDestinationSchema
  > | null>(null);
  const pending = useRef<PendingCommand | null>(null),
    locked = useRef(false);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    let lastDay = "";
    function tick() {
      const current = localField(new Date()).slice(0, 10);
      if (lastDay !== current) {
        const previous = lastDay;
        lastDay = current;
        setToday(current);
        setDay((selected) =>
          !selected || selected === previous ? current : selected,
        );
      }
    }
    tick();
    const timer = window.setInterval(tick, 60000);
    return () => window.clearInterval(timer);
  }, [actor]);
  useEffect(() => {
    if (!day) return;
    const c = new AbortController();
    const query = new URLSearchParams({ day, zone });
    void api<unknown>("/api/v1/agenda?" + query, undefined, c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          const next = agendaViewSchema.parse(v);
          setView(next);
          onCalendarLinked(next.hasLinkedCalendar ?? null);
          setError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          onCalendarLinked(null);
          setError(errorText(e));
        }
      });
    return () => c.abort();
  }, [actor, day, zone, revision, onCalendarLinked]);
  useEffect(() => {
    const focus = () => {
      if (!document.hidden) refresh((n) => n + 1);
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, []);
  useEffect(() => {
    if (!destination || editor !== "event") return;
    const c = new AbortController();
    void api<unknown>(
      "/api/v1/agenda/destination?workspace=" + destination,
      undefined,
      c.signal,
    )
      .then((v) => {
        if (!c.signal.aborted)
          setConfiguration(agendaDestinationSchema.parse(v));
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [destination, editor, revision]);
  const heading = useRef<HTMLButtonElement>(null);
  const connectionsButton = useRef<HTMLButtonElement>(null);
  function showAgenda(next: boolean) {
    setExpanded(next);
    try {
      localStorage.setItem("rimiam:today:" + actor, next ? "open" : "closed");
    } catch {
      /* Device storage is optional. */
    }
  }
  useImperativeHandle(ref, () => ({
    openCalendars() {
      setExternal(true);
      connectionsButton.current?.focus();
    },
    openToday() {
      setExternal(false);
      setCalendar(false);
      setDay(localField(new Date()).slice(0, 10));
      setFilter("all");
      showAgenda(true);
      heading.current?.focus();
    },
  }));
  function start(kind: Editor, item: Item | null = null) {
    setConfiguration(null);
    setEditor(kind);
    setEdit(item);
    setDestination(item && !item.personal ? item.workspaceId : "");
    setRepeat(once);
    setError("");
  }
  async function run(fn: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      refresh((n) => n + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function command(w: string, c: Command) {
    const previous = pending.current;
    if (
      !previous ||
      previous.workspace !== w ||
      JSON.stringify(previous.command) !== JSON.stringify(c)
    )
      pending.current = newCommand(actor, w, c);
    await sendCommand(pending.current!);
    pending.current = null;
  }
  function act(w: string, c: Command) {
    void run(() => command(w, c));
  }
  async function save(form: FormData) {
    const title = String(form.get("title")).trim(),
      field = String(form.get("at")),
      instant = new Date(field);
    if (Number.isNaN(+instant) || localField(instant) !== field)
      throw new Error("Scegli un orario valido nel fuso del dispositivo.");
    const at = instant.toISOString();
    const w =
      edit?.workspaceId ||
      destination ||
      personalSpaceResultSchema.parse(
        await api<unknown>("/api/v1/personal-space", {
          expectedActorId: actor,
        }),
      ).id;
    if (edit) {
      const action =
        form.get("mode") === "following" ? "replace_following" : "replace";
      await command(w, {
        type: "followup.occurrence",
        action,
        followupId: edit.id,
        expectedVersion: edit.version,
        scheduledAt: edit.at,
        replacement: { content: title, remindAt: at, timeZone: zone },
      });
    } else if (editor === "reminder") {
      const recurrence = repeatRule(repeat);
      if (recurrence && !recurrence.weekdays.length)
        throw new Error("Scegli almeno un giorno.");
      await command(w, {
        type: "followup.create",
        kind: "remember",
        content: title,
        remindAt: at,
        timeZone: zone,
        reference: null,
        recurrence,
      });
    } else {
      const config = destination
        ? configuration
        : agendaDestinationSchema.parse(
            await api<unknown>("/api/v1/agenda/destination?workspace=" + w),
          );
      if (!config)
        throw new Error("Attendi il caricamento della destinazione.");
      const endField = String(form.get("end")),
        endDate = new Date(endField);
      if (Number.isNaN(+endDate) || localField(endDate) !== endField)
        throw new Error(
          "Scegli un orario di fine valido nel fuso del dispositivo.",
        );
      const end = endDate.toISOString();
      if (end <= at)
        throw new Error("La fine deve essere successiva all’inizio.");
      await command(w, {
        type: "temporal.create",
        representSelf: true,
        reason: "Appuntamento creato dalla Home",
        expectedContextRevision: config.contextRevision,
        payload: { title, start: at, end, timeZone: zone },
        audience: audienceFromForm(form),
      });
    }
    setEditor(null);
    setEdit(null);
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void run(() => save(data));
  }
  const selected =
    view?.items.filter(
      (i) =>
        filter === "all" || (filter === "personal" ? i.personal : !i.personal),
    ) ?? [];
  return (
    <section className={styles.today} aria-label={uiText("Agenda personale")}>
      <header>
        <button
          type="button"
          ref={heading}
          className={styles.heading}
          aria-expanded={expanded}
          onClick={() => showAgenda(!expanded)}
        >
          {uiText("Oggi")}
          <WorkspaceIcon name="chevron" />
        </button>
        <button
          type="button"
          ref={connectionsButton}
          className={styles.connections}
          aria-expanded={external}
          aria-controls="home-connected-calendars"
          onClick={() => setExternal((open) => !open)}
        >
          <WorkspaceIcon name="calendar" />
          {uiText(calendarConnectionLabel(calendarLinked))}
        </button>
        <div className={styles.actions}>
          <button
            type="button"
            className="quiet"
            aria-expanded={calendar}
            onClick={() => {
              setCalendar(!calendar);
              if (calendar) setDay(today);
              else setExpanded(true);
            }}
          >
            <WorkspaceIcon name="calendar" />
            {uiText("Calendario")}
          </button>
          <button
            type="button"
            className="quiet"
            aria-label={uiText("Nuovo promemoria")}
            onClick={() => start("reminder")}
          >
            <WorkspaceIcon name="plus" />
            {uiText("Promemoria")}
          </button>
          <button
            type="button"
            className="quiet"
            aria-label={uiText("Nuovo appuntamento")}
            onClick={() => start("event")}
          >
            <WorkspaceIcon name="plus" />
            {uiText("Appuntamento")}
          </button>
        </div>
      </header>
      <div id="home-connected-calendars" hidden={!external}>
        {external &&
          (archive ? (
            <PersonalCalendar
              key={archive + day}
              initialDay={day}
              personal
              workspace={archive}
              actor={actor}
              revision={revision}
              busy={busy}
              action={run}
              command={(c) => command(archive, c)}
            />
          ) : archiveError ? (
            <p role="alert">
              {archiveError}{" "}
              <button
                type="button"
                onClick={() => {
                  setArchiveError("");
                  setArchiveAttempt((n) => n + 1);
                }}
              >
                {uiText("Riprova")}
              </button>
            </p>
          ) : (
            <p role="status">{uiText("Caricamento dei calendari…")}</p>
          ))}
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button className="quiet" onClick={() => refresh((n) => n + 1)}>
            {uiText("Ricarica agenda")}
          </button>
        </p>
      )}
      {editor && (
        <form
          key={(edit?.id ?? "new") + editor}
          className={styles.form}
          onSubmit={submit}
        >
          <h3>
            {edit
              ? uiText("Modifica promemoria")
              : editor === "event"
                ? uiText("Nuovo appuntamento")
                : uiText("Nuovo promemoria")}
          </h3>
          {!edit && (
            <label>
              {uiText("Destinazione")}
              <select
                value={destination}
                onChange={(e) => {
                  setConfiguration(null);
                  setDestination(e.target.value);
                }}
              >
                <option value="">{uiText("Solo io")}</option>
                {spaces.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {destination && editor === "event" && (
            <CalendarAudienceFields
              key={destination}
              members={configuration?.members ?? []}
            />
          )}
          {destination && editor === "reminder" && (
            <small>
              {uiText(
                "Per tutti nello spazio, anche chi entrerà prima delle prossime scadenze.",
              )}
            </small>
          )}
          <label>
            {editor === "event" ? uiText("Titolo") : uiText("Cosa ricordare")}
            <input
              required
              maxLength={editor === "event" ? 200 : 2000}
              name="title"
              defaultValue={edit?.title}
            />
          </label>
          <label>
            {editor === "event" ? uiText("Inizio") : uiText("Quando")}
            <input
              required
              type="datetime-local"
              name="at"
              defaultValue={
                edit ? localField(new Date(edit.at)) : day + "T09:00"
              }
            />
          </label>
          {editor === "event" && (
            <label>
              {uiText("Fine")}
              <input
                required
                type="datetime-local"
                name="end"
                defaultValue={day + "T10:00"}
              />
            </label>
          )}
          {editor === "reminder" && !edit && (
            <ReminderRepeatFields draft={repeat} onChange={setRepeat} />
          )}
          {edit?.recurring && (
            <label>
              {uiText("Applica a")}
              <select name="mode" defaultValue="only">
                <option value="only">
                  {uiText("Solo questo ")}
                  {weekday(uiLocale).format(new Date(edit.at))}
                </option>
                <option value="following">
                  {uiText("Da questo ")}
                  {weekday(uiLocale).format(new Date(edit.at))}
                  {uiText(" in poi")}
                </option>
              </select>
            </label>
          )}
          <div className={styles.actions}>
            <button
              disabled={
                busy || !!(destination && editor === "event" && !configuration)
              }
            >
              {uiText("Salva ")}
              {editor === "event"
                ? uiText("appuntamento")
                : uiText("promemoria")}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => setEditor(null)}
            >
              {uiText("Annulla")}
            </button>
          </div>
        </form>
      )}
      {expanded && (
        <>
          <div className={styles.actions}>
            {calendar && (
              <label>
                {uiText("Scegli giorno")}
                <input
                  type="date"
                  value={day}
                  onChange={(e) => {
                    if (e.target.value) {
                      setView(null);
                      setDay(e.target.value);
                    }
                  }}
                />
              </label>
            )}
            {(!!view?.items.length || filter !== "all") && (
              <label className={styles.filter}>
                {uiText("Mostra")}
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">{uiText("Tutto")}</option>
                  <option value="personal">{uiText("Solo io")}</option>
                  <option value="spaces">{uiText("Spazi")}</option>
                </select>
              </label>
            )}
          </div>
          {!view && !error && (
            <p role="status">{uiText("Caricamento agenda…")}</p>
          )}
          {view && !selected.length && (
            <p>{uiText("Nessun impegno per questa giornata.")}</p>
          )}
          {selected.map((i) => (
            <details key={i.id + i.at} className={styles.row}>
              <summary>
                <time dateTime={i.at}>
                  {clock(uiLocale).format(new Date(i.at))}
                </time>
                <span>
                  <strong>{i.title}</strong>
                  <small>
                    {i.personal ? uiText("Solo io") : i.workspaceName}
                    {i.rsvp === "pending" ? uiText(" · Da confermare") : ""}
                  </small>
                </span>
              </summary>
              {i.kind === "event" ? (
                <>
                  <p>
                    {uiText("Fino alle ")}
                    {i.until && clock(uiLocale).format(new Date(i.until))}
                  </p>
                  {i.rsvp === "pending" && (
                    <div className={styles.actions}>
                      {(["accepted", "declined"] as const).map((response) => (
                        <button
                          key={response}
                          disabled={busy}
                          onClick={() =>
                            act(i.workspaceId, {
                              type: "temporal.respond",
                              eventId: i.id,
                              expectedVersion: i.version,
                              response,
                            })
                          }
                        >
                          {response === "accepted"
                            ? uiText("Accetta")
                            : uiText("Rifiuta")}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.actions}>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      act(i.workspaceId, {
                        type: "followup.occurrence",
                        followupId: i.id,
                        expectedVersion: i.version,
                        scheduledAt: i.at,
                        action: i.personal ? "close" : "hide",
                      })
                    }
                  >
                    {i.personal
                      ? uiText("Archivia")
                      : uiText("Nascondi per me")}
                  </button>
                  {i.owner === actor && (
                    <>
                      <button
                        className="quiet"
                        onClick={() => start("reminder", i)}
                      >
                        {uiText("Modifica")}
                      </button>
                      {!i.personal && (
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            act(i.workspaceId, {
                              type: "followup.occurrence",
                              followupId: i.id,
                              expectedVersion: i.version,
                              scheduledAt: i.at,
                              action: "close",
                            })
                          }
                        >
                          {uiText("Chiudi per tutti")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </details>
          ))}
          {!!view?.previous.length && (
            <details>
              <summary>
                {uiText("Promemoria precedenti · ")}
                {view.previous.length}
              </summary>
              {view.previous.map((p) => (
                <div key={p.id} className={styles.older}>
                  <strong>{p.title}</strong> · {p.count}{" "}
                  {p.count === 1 ? uiText("scadenza") : uiText("scadenze")}
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      act(p.workspaceId, {
                        type: "followup.previous",
                        followupId: p.id,
                        before: view.before,
                        timeZone: zone,
                        action: "archive",
                      })
                    }
                  >
                    {uiText("Archivia")}
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const time = new FormData(e.currentTarget).get("time");
                      act(p.workspaceId, {
                        type: "followup.previous",
                        followupId: p.id,
                        before: view.before,
                        timeZone: zone,
                        action: "remind_today",
                        remindAt: new Date(today + "T" + time).toISOString(),
                      });
                    }}
                  >
                    <label>
                      {uiText("Orario di oggi")}
                      <input name="time" type="time" required />
                    </label>
                    <button className="quiet" disabled={busy}>
                      {uiText("Ricordamelo oggi")}
                    </button>
                  </form>
                </div>
              ))}
            </details>
          )}
        </>
      )}
      {!!view?.offers.length && (
        <section aria-label={uiText("In attesa di te")}>
          <h3>{uiText("In attesa di te")}</h3>
          {view.offers.map((o) => (
            <details key={o.id}>
              <summary>
                {o.title} · {o.workspaceName}
              </summary>
              <p>{o.description}</p>
              {o.due && (
                <p>
                  {uiText("Scadenza: ")}
                  {new Date(o.due).toLocaleString(uiLocale)}
                </p>
              )}
              <div className={styles.actions}>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(o.workspaceId, {
                      type: "task.accept",
                      taskId: o.id,
                      expectedVersion: o.version,
                      reason: "Accettazione personale dalla Home",
                      representSelf: true,
                    })
                  }
                >
                  {uiText("Accetta")}
                </button>
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    act(o.workspaceId, {
                      type: "task.decline",
                      taskId: o.id,
                      expectedVersion: o.version,
                      reason: "Proposta rifiutata dalla Home",
                    })
                  }
                >
                  {uiText("Rifiuta")}
                </button>
              </div>
            </details>
          ))}
        </section>
      )}
    </section>
  );
}
