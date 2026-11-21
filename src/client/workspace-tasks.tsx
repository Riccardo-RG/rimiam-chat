"use client";
import { localizedDate } from "../shared/i18n/date";
import { useUiLanguage } from "./ui-language";

import { reminderTime, sortedReminders } from "../shared/followup-order";
import type { z } from "zod";
import { TaskComments } from "./task-comments";
import { WorkspaceSchedule } from "./workspace-schedule";
import { ProductHelp } from "./product-help";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./workspace-tasks.module.css";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Command } from "@/contracts/commands";
import type { ConversationHandoff } from "@/contracts/conversation-handoff";
import { taskDraft } from "./task-draft";
import {
  ReminderRepeatFields,
  describeRepeat,
  once,
  repeatDraft,
  repeatRule,
  reminderState,
} from "./reminder-repeat";
import type {
  TasksView,
  TaskItem,
  TaskContent,
  FollowupItem,
  tasksHistorySchema,
  WorkRef,
} from "@/contracts/tasks";
type TaskHistory = z.infer<typeof tasksHistorySchema>;
const empty: TaskContent = {
  title: "",
  description: "",
  dueAt: null,
  timeZone: "Europe/Rome",
  suggestedPerson: null,
  references: [],
};
const taskStatus: Record<TaskItem["status"], string> = {
  open: "Aperta",
  in_progress: "In corso",
  standby: "In standby",
  completed: "Completata",
  cancelled: "Annullata",
};

const reminderKinds: Record<FollowupItem["kind"], string> = {
  remember: "Ricordare qualcosa",
  check: "Fare una verifica",
  request_update: "Chiedere un aggiornamento",
  review: "Rivedere un elemento",
};

function dateField(instant: string) {
  const date = new Date(instant);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const localDate = localizedDate({
  dateStyle: "medium",
  timeStyle: "short",
});

function closeEditor(editor: HTMLDetailsElement | null) {
  if (!editor) return;
  editor.open = false;
  editor.querySelector("summary")?.focus({ preventScroll: true });
}

function openEditor(editor: HTMLDetailsElement | null) {
  if (!editor) return;
  editor.open = true;
  editor.querySelector("input")?.focus();
}

export function WorkspaceTasks({
  workspace,
  actor,
  command,
  action,
  busy,
  handoff: incomingHandoff,
  canContribute,
  createRequest,
  personal = false,
}: {
  workspace: string;
  actor: string;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  handoff?: ConversationHandoff;
  canContribute: boolean;
  createRequest?: number;
  personal?: boolean;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const handoff = personal ? undefined : incomingHandoff;
  const [view, setView] = useState<TasksView | null>(null),
    [error, setError] = useState(""),
    [before, setBefore] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskItem | null>(null),
    [content, setContent] = useState<TaskContent>(
      handoff?.kind === "task.create" && handoff.status === "ready"
        ? {
            ...empty,
            title: [...handoff.suggestedText].slice(0, 160).join(""),
            description: handoff.suggestedText,
            references: [
              { kind: "message", id: handoff.sourceMessageId, version: 1 },
            ],
          }
        : empty,
    ),
    [reason, setReason] = useState(""),
    [candidate, setCandidate] = useState<string | undefined>(
      handoff?.candidateId ?? undefined,
    ),
    [originId, setOriginId] = useState(
      handoff?.kind === "task.create" && handoff.status === "ready"
        ? handoff.id
        : null,
    ),
    [history, setHistory] = useState<{
      id: string;
      data: TaskHistory;
    } | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [follow, setFollow] = useState<TasksView["followups"][number] | null>(
      null,
    ),
    [reminder, setReminder] = useState(""),
    [kind, setKind] = useState<FollowupItem["kind"]>("remember"),
    [at, setAt] = useState(""),
    [repeat, setRepeat] = useState(once),
    [repeatError, setRepeatError] = useState(""),
    [target, setTarget] = useState<WorkRef | null>(null);
  const [openTaskIds, setOpenTaskIds] = useState<Set<string>>(() => new Set());
  const [mine, setMine] = useState(false),
    [scheduleFocus, setScheduleFocus] = useState<string | null>(null);
  const url = `/api/v1/workspaces/${workspace}/tasks${scheduleFocus ? "?focus=" + scheduleFocus : before ? `?before=${before}` : ""}`;
  const preparedHandoff = useRef<string | undefined>(undefined);
  const root = useRef<HTMLElement>(null);
  const taskEditor = useRef<HTMLDetailsElement>(null);
  const reminderEditor = useRef<HTMLDetailsElement>(null);
  const openedRequest = useRef<number | undefined>(undefined);
  const focusedRequest = useRef<number | undefined>(undefined);
  const viewReady = !!view;
  useEffect(() => {
    const editor = taskEditor.current;
    if (!editor || !canContribute || createRequest === undefined) return;
    if (createRequest !== openedRequest.current) {
      openedRequest.current = createRequest;
      editor.open = true;
    }
    // The form can be inspected immediately. Its fields become available when
    // the authorized Tasks view arrives. A manual collapse survives that read.
    if (viewReady && editor.open && focusedRequest.current !== createRequest) {
      focusedRequest.current = createRequest;
      editor.querySelector("input")?.focus();
    }
  }, [viewReady, canContribute, createRequest]);
  const revealedPrepared = useRef("");
  const readScope = useRef(0);
  const readRequest = useRef(0);
  const preparedId = handoff?.application?.prepared?.id;
  useEffect(() => {
    if (!preparedId || revealedPrepared.current === preparedId) return;
    const element = root.current?.querySelector<HTMLElement>(
      `[data-prepared-id="${CSS.escape(preparedId)}"]`,
    );
    if (element) {
      const row = element.closest("details");
      if (row) row.open = true;
      element.scrollIntoView({ block: "center" });
      element.focus({ preventScroll: true });
      revealedPrepared.current = preparedId;
    }
  }, [preparedId, view]);
  useEffect(() => {
    const scope = ++readScope.current;
    let running = false;
    const read = async () => {
      if (running || document.hidden) return;
      running = true;
      const request = ++readRequest.current;
      try {
        const v = await api<TasksView>(url);
        if (scope === readScope.current && request === readRequest.current) {
          setView(v);
          setError("");
          if (
            handoff?.kind === "task.change" &&
            ["ready", "applied"].includes(handoff.status) &&
            preparedHandoff.current !== handoff.id
          ) {
            const task = v.tasks.find((t) => t.id === handoff.target?.id);
            if (task) {
              if (handoff.status === "ready") {
                setEditing(task);
                setOriginId(handoff.id);
                setContent({
                  ...taskDraft(task),
                  description: handoff.suggestedText,
                });
                setReason(handoff.summary);
                openEditor(taskEditor.current);
              }
              preparedHandoff.current = handoff.id;
            } else if (v.next) setBefore(v.next);
            else
              setError(
                uiText(
                  "Il Task della proposta non è disponibile. Torna alla conversazione per rivalutarlo.",
                ),
              );
          }
        }
      } catch (e) {
        if (scope === readScope.current && request === readRequest.current) {
          setView(null);
          historyRequest.current?.abort();
          setHistory(null);
          setLoadingHistory(null);
          setError((e as Error).message);
        }
      } finally {
        running = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      readScope.current = scope + 1;
      historyRequest.current?.abort();
      clearInterval(timer);
    };
  }, [url, actor, handoff, uiText]);
  const perform = async (c: Command) => {
    const scope = readScope.current;
    let committed = false;
    await action(async () => {
      await command(c);
      window.dispatchEvent(new Event("rimiam-schedule-changed"));
      committed = true;
      await refreshAfterCommit(scope);
    });
    return committed;
  };
  const refreshAfterCommit = async (scope: number) => {
    if (scope !== readScope.current) return;
    // Keep polling and post-command reads in the same request order, including
    // errors; page changes invalidate the scope captured before the command.
    const request = ++readRequest.current;
    try {
      const v = await api<TasksView>(url);
      if (scope === readScope.current && request === readRequest.current) {
        setView(v);
        setError("");
      }
    } catch {
      if (scope === readScope.current && request === readRequest.current)
        setError(
          uiText(
            "Modifica salvata. La schermata si aggiornerà appena possibile.",
          ),
        );
    }
  };
  const reset = () => {
    setEditing(null);
    setOriginId(null);
    setContent(empty);
    setCandidate(undefined);
    setReason("");
    closeEditor(taskEditor.current);
  };
  const cancelReminder = () => {
    setFollow(null);
    setReminder("");
    setKind("remember");
    setRepeat(once);
    setRepeatError("");
    setAt("");
    setTarget(null);
    closeEditor(reminderEditor.current);
  };
  const name = (id: string | null) =>
    id
      ? (view?.members.find((m) => m.id === id)?.name ??
        "Membro non disponibile")
      : "Non assegnato";
  const readHistory = async (
    id: string,
    kind: "task" | "followup",
    more?: NonNullable<TaskHistory["nextDelivery"]>,
  ) => {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    const scope = readScope.current;
    const query = new URLSearchParams({ id, kind });
    if (more) {
      query.set("beforeDeliveryVersion", String(more.version));
      query.set("beforeDeliveryAt", more.scheduledAt);
    } else {
      setHistory(null);
    }
    setLoadingHistory(id);
    try {
      const data = await api<TaskHistory>(
        `/api/v1/workspaces/${workspace}/tasks-history?${query}`,
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted || scope !== readScope.current) return;
      if (!more) setHistory({ id, data });
      else
        setHistory((current) =>
          current?.id === id &&
          current.data.nextDelivery?.scheduledAt === more.scheduledAt &&
          current.data.nextDelivery?.version === more.version
            ? {
                id,
                data: {
                  ...current.data,
                  nextDelivery: data.nextDelivery,
                  proposals: [...current.data.proposals, ...data.proposals],
                },
              }
            : current,
        );
    } catch {
      if (!controller.signal.aborted && scope === readScope.current)
        setError(uiText("Impossibile caricare la cronologia. Riprova."));
    } finally {
      if (controller === historyRequest.current) {
        historyRequest.current = null;
        setLoadingHistory(null);
      }
    }
  };
  const historyControl = (id: string, kind: "task" | "followup") => {
    const opened = history?.id === id;
    return (
      <>
        <button
          type="button"
          className="quiet"
          aria-expanded={opened}
          disabled={!opened && loadingHistory === id}
          onClick={() => {
            if (opened) {
              historyRequest.current?.abort();
              setHistory(null);
              return;
            }
            void readHistory(id, kind);
          }}
        >
          {opened
            ? uiText("Chiudi cronologia")
            : loadingHistory === id
              ? uiText("Caricamento cronologia…")
              : uiText("Cronologia")}
        </button>
        {opened && (
          <section
            aria-label={uiText("Cronologia delle modifiche")}
            className={styles.history}
          >
            <ol>
              {history.data.versions.map((v) => (
                <li key={String(v.version)}>
                  <strong>
                    {uiText("Versione ")}
                    {String(v.version)}
                  </strong>{" "}
                  · {name(String(v.actor_id))}
                  <div>{String(v.title ?? v.content ?? "")}</div>
                </li>
              ))}
            </ol>
            <details className={styles.row}>
              <summary>
                {uiText("Dettagli delle versioni e dei riferimenti")}
              </summary>
              <pre>{JSON.stringify(history.data, null, 2)}</pre>
              {kind === "followup" && history.data.nextDelivery && (
                <button
                  type="button"
                  className="quiet"
                  disabled={loadingHistory === id}
                  onClick={() => {
                    if (!historyRequest.current && history.data.nextDelivery)
                      void readHistory(id, kind, history.data.nextDelivery);
                  }}
                >
                  {loadingHistory === id
                    ? uiText("Caricamento consegne…")
                    : uiText("Consegne precedenti")}
                </button>
              )}
            </details>
          </section>
        )}
      </>
    );
  };
  const base = (t: TaskItem) => ({
    taskId: t.id,
    expectedVersion: t.version,
    reason: "Aggiornamento esplicito",
  });
  const closedTask = (t: TaskItem) =>
    t.status === "completed" || t.status === "cancelled";
  // The API paginates the two lists together. Order the visible records only.
  const tasks = [...(view?.tasks ?? [])].sort((a, b) => {
    const due = (t: TaskItem) =>
      t.dueAt ? Date.parse(t.dueAt) : Number.POSITIVE_INFINITY;
    return (
      Number(closedTask(a)) - Number(closedTask(b)) ||
      due(a) - due(b) ||
      b.createdAt.localeCompare(a.createdAt)
    );
  });
  useEffect(() => {
    if (scheduleFocus && view) {
      const row = root.current?.querySelector<HTMLDetailsElement>(
        '[data-schedule-id="' + scheduleFocus + '"]',
      );
      if (row && !row.open) {
        row.open = true;
        row.querySelector("summary")?.focus();
      }
    }
  }, [scheduleFocus, view]);
  const canManage = (t: TaskItem) =>
    canContribute &&
    (!t.responsible || (t.responsible === actor && t.responsibleAvailable));
  const updateStatus = (t: TaskItem, status: TaskItem["status"]) =>
    perform({
      type: "task.status",
      ...base(t),
      status,
      noNormativeEffect: true,
    });
  const assignment = (t: TaskItem) => {
    if (t.responsible)
      return t.responsibleAvailable
        ? t.responsible === actor
          ? "Te ne occupi tu"
          : name(t.responsible)
        : name(t.responsible) + " · accesso cessato";
    if (t.suggestedPerson && !closedTask(t))
      return t.declinedBy
        ? "Proposta rifiutata"
        : t.suggestedPerson === actor
          ? "In attesa di te"
          : "In attesa di " + name(t.suggestedPerson);
    return "Non assegnata";
  };
  const visibleTasks = tasks.filter(
    (t) => !mine || (t.responsible === actor && t.responsibleAvailable),
  );
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ruleZone = follow?.timeZone ?? deviceZone;
  const reminders = sortedReminders(view?.followups ?? []);
  const linkedTask =
    target?.kind === "task" ? tasks.find((t) => t.id === target.id) : undefined;
  return (
    <section
      ref={root}
      className={styles.overview}
      data-personal={personal || undefined}
      aria-label={
        personal
          ? uiText("Promemoria personali")
          : uiText("Da fare e promemoria")
      }
    >
      {error && <p role="alert">{error}</p>}
      {!view && !error && (
        <p className="hint" role="status">
          {personal
            ? uiText("Caricamento dei promemoria…")
            : uiText("Caricamento di attività e promemoria…")}
        </p>
      )}
      {!personal && (
        <WorkspaceSchedule
          workspace={workspace}
          mine={mine}
          onMine={(v) => {
            setMine(v);
            setScheduleFocus(null);
          }}
          onPick={(id) => setScheduleFocus(id)}
        />
      )}
      {scheduleFocus && (
        <button className="quiet" onClick={() => setScheduleFocus(null)}>
          {uiText("Torna a tutte le attività")}
        </button>
      )}
      {(view?.next || before) && (
        <p className="hint">
          {personal
            ? uiText("Stai consultando una pagina dei tuoi promemoria.")
            : uiText(
                "Stai consultando una pagina delle attività e dei promemoria dello spazio.",
              )}
        </p>
      )}
      {!personal && (
        <section
          className={styles.group}
          aria-label={uiText("Elenco delle attività")}
        >
          <h2>{uiText("Attività")}</h2>
          {canContribute && (
            <details
              ref={taskEditor}
              className={styles.editor}
              open={
                handoff?.kind === "task.create" && handoff.status === "ready"
              }
            >
              <summary>
                <WorkspaceIcon name="work" />{" "}
                <span>
                  {editing
                    ? uiText("Rivedi attività")
                    : uiText("Nuova attività")}
                </span>
                {!editing && (
                  <kbd title={uiText("Scorciatoia nella chat")}>
                    {uiText("/task")}
                  </kbd>
                )}
              </summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    const scope = readScope.current;
                    if (
                      originId &&
                      (handoff?.id !== originId ||
                        handoff.status !== "ready" ||
                        (editing
                          ? handoff.kind !== "task.change" ||
                            handoff.target?.id !== editing.id
                          : handoff.kind !== "task.create"))
                    )
                      throw new Error(
                        "La proposta selezionata è cambiata. Rivalutala o esci dal percorso prima di registrare questo lavoro.",
                      );
                    const origin = originId
                      ? { conversationOrigin: { handoffId: originId } }
                      : {};
                    await command(
                      editing
                        ? {
                            type: editing.responsible
                              ? "task.propose_revision"
                              : "task.revise",
                            ...base(editing),
                            reason,
                            content,
                            ...origin,
                          }
                        : {
                            type: "task.create",
                            content,
                            ...origin,
                            ...(candidate ? { candidateId: candidate } : {}),
                          },
                    );
                    if (scope === readScope.current) reset();
                    await refreshAfterCommit(scope);
                  });
                }}
              >
                <fieldset disabled={busy || !view}>
                  <label>
                    {uiText("Attività")}
                    <input
                      required
                      value={content.title}
                      onChange={(e) =>
                        setContent({ ...content, title: e.target.value })
                      }
                    />
                  </label>
                  {!editing && (
                    <p className="hint">
                      {uiText(
                        "Se scegli una persona, riceverà una proposta da accettare.",
                      )}
                    </p>
                  )}
                  <label>
                    {uiText("Perimetro e aspettative")}
                    <textarea
                      value={content.description}
                      onChange={(e) =>
                        setContent({ ...content, description: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {uiText("Scadenza facoltativa")}
                    <input
                      type="datetime-local"
                      value={content.dueAt ? dateField(content.dueAt) : ""}
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
                  {!editing?.responsible && (
                    <label>
                      {uiText("Proponi a")}
                      <select
                        value={content.suggestedPerson ?? ""}
                        onChange={(e) =>
                          setContent({
                            ...content,
                            suggestedPerson: e.target.value || null,
                          })
                        }
                      >
                        <option value="">{uiText("Nessuno")}</option>
                        {view?.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {editing && (
                    <label>
                      {uiText("Motivo della modifica")}
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        required={!!editing}
                      />
                    </label>
                  )}
                  {content.references.map((r) => (
                    <p key={`${r.kind}${r.id}`}>
                      {uiText("Riferimento ")}
                      {r.kind}: {r.id}
                      {uiText(" · v")}
                      {r.version}
                    </p>
                  ))}
                </fieldset>
                <div className={styles.formActions}>
                  <button disabled={busy || !view}>
                    {editing?.responsible
                      ? uiText("Proponi modifica da accettare")
                      : editing
                        ? uiText("Salva modifica")
                        : uiText("Crea attività")}
                  </button>
                  <button
                    className="quiet"
                    type="button"
                    disabled={busy}
                    onClick={reset}
                  >
                    {uiText("Annulla")}
                  </button>
                </div>
              </form>
            </details>
          )}
          {view && !visibleTasks.length && (
            <p className="hint">
              {mine
                ? uiText("Nessuna attività assegnata a te in questa pagina.")
                : before || view.next
                  ? uiText("Nessuna attività in questa pagina.")
                  : canContribute
                    ? uiText(
                        "Nessuna attività in programma. Puoi crearne una qui o scrivere /task in chat.",
                      )
                    : uiText("Nessuna attività.")}
            </p>
          )}
          {view &&
            visibleTasks.map((t) => (
              <article key={t.id} className={styles.taskEntry}>
                <details
                  className={styles.taskRow}
                  onToggle={(e) => {
                    const open = e.currentTarget.open;
                    setOpenTaskIds((ids) => {
                      if (ids.has(t.id) === open) return ids;
                      const next = new Set(ids);
                      if (open) next.add(t.id);
                      else next.delete(t.id);
                      return next;
                    });
                  }}
                  data-schedule-id={t.id}
                >
                  <summary>
                    <span className={styles.taskName}>
                      <strong>{t.title}</strong>
                      {t.dueAt && (
                        <time dateTime={t.dueAt}>
                          {uiText("Scade il ")}
                          {localDate(uiLocale).format(new Date(t.dueAt))}
                        </time>
                      )}
                    </span>
                    <span className={styles.status} data-state={t.status}>
                      {uiText(taskStatus[t.status])}
                    </span>
                    <span className={styles.assignee}>{assignment(t)}</span>
                  </summary>
                  <div className={styles.taskDetail}>
                    {t.description && <p>{t.description}</p>}
                    <p>
                      {uiText(taskStatus[t.status])}
                      {uiText(" · v")}
                      {t.version} ·{" "}
                      {t.dueAt
                        ? new Date(t.dueAt).toLocaleString()
                        : uiText("Senza scadenza")}
                    </p>
                    <p>
                      {uiText("Responsabilità: ")}
                      {name(t.responsible)}
                      {t.responsible
                        ? uiText(
                            " · accettata su v{0}{1}",
                            String(t.acceptedVersion),
                            String(
                              t.responsibleAvailable
                                ? ""
                                : " · accesso non disponibile",
                            ),
                          )
                        : ""}
                    </p>
                    {!t.responsible && t.suggestedPerson && !closedTask(t) && (
                      <p>
                        {t.declinedBy
                          ? uiText("Proposta rifiutata da")
                          : uiText("Proposta inviata a")}{" "}
                        {name(t.suggestedPerson)}.
                      </p>
                    )}
                    <div className={styles.taskActions}>
                      {canContribute &&
                        !t.responsible &&
                        !closedTask(t) &&
                        (!t.suggestedPerson ||
                          (t.suggestedPerson === actor && !t.declinedBy)) && (
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
                            {t.suggestedPerson
                              ? uiText("Accetta incarico")
                              : uiText("Me ne occupo")}
                          </button>
                        )}
                      {canContribute &&
                        !t.responsible &&
                        !closedTask(t) &&
                        t.suggestedPerson === actor &&
                        !t.declinedBy && (
                          <button
                            type="button"
                            className="quiet"
                            disabled={busy}
                            onClick={() =>
                              void perform({ type: "task.decline", ...base(t) })
                            }
                          >
                            {uiText("Rifiuta incarico")}
                          </button>
                        )}
                      {canContribute &&
                        !t.responsible &&
                        !closedTask(t) &&
                        view.members.some(
                          (m) =>
                            m.id !== actor &&
                            (m.id !== t.suggestedPerson || !!t.declinedBy),
                        ) && (
                          <form
                            key={t.version}
                            className={styles.offer}
                            onSubmit={(e) => {
                              e.preventDefault();
                              const recipient = new FormData(
                                e.currentTarget,
                              ).get("recipient");
                              if (typeof recipient !== "string" || !recipient)
                                return;
                              void perform({
                                type: "task.revise",
                                ...base(t),
                                reason: "Proposta di responsabilità",
                                content: {
                                  ...taskDraft(t),
                                  suggestedPerson: recipient,
                                },
                              });
                            }}
                          >
                            <label>
                              <span className="sr-only">
                                {uiText("Persona a cui proporre l’attività")}
                              </span>
                              <select
                                name="recipient"
                                defaultValue=""
                                required
                                disabled={busy}
                              >
                                <option value="" disabled>
                                  {uiText("Scegli una persona")}
                                </option>
                                {view.members
                                  .filter(
                                    (m) =>
                                      m.id !== actor &&
                                      (m.id !== t.suggestedPerson ||
                                        !!t.declinedBy),
                                  )
                                  .map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <button
                              type="submit"
                              className="quiet"
                              disabled={busy}
                            >
                              {uiText("Proponi incarico")}
                            </button>
                          </form>
                        )}
                      {canContribute && t.responsible === actor && (
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            void perform({
                              type: "task.relinquish",
                              ...base(t),
                              representSelf: true,
                            })
                          }
                        >
                          {uiText("Lascio la responsabilità")}
                        </button>
                      )}
                      {canManage(t) &&
                        (closedTask(t) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void updateStatus(t, "open")}
                          >
                            {uiText("Riapri attività")}
                          </button>
                        ) : (
                          <>
                            <label className={styles.changeStatus}>
                              {uiText("Stato")}
                              <select
                                aria-label={uiText("Stato")}
                                value={t.status}
                                disabled={busy}
                                onChange={(e) => {
                                  const value = e.currentTarget.value;
                                  if (
                                    value === "open" ||
                                    value === "in_progress" ||
                                    value === "standby"
                                  )
                                    void updateStatus(t, value);
                                }}
                              >
                                <option value="open">{uiText("Aperta")}</option>
                                <option value="in_progress">
                                  {uiText("In corso")}
                                </option>
                                <option value="standby">
                                  {uiText("In standby")}
                                </option>
                              </select>
                            </label>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void updateStatus(t, "completed")}
                            >
                              {uiText("Segna come completata")}
                            </button>
                          </>
                        ))}
                    </div>
                    {canContribute &&
                      !["completed", "cancelled"].includes(t.status) && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setEditing(t);
                            setOriginId(null);
                            setReason("");
                            setContent(taskDraft(t));
                            setCandidate(undefined);
                            openEditor(taskEditor.current);
                          }}
                        >
                          {t.responsible
                            ? uiText("Proponi modifica")
                            : uiText("Modifica attività")}
                        </button>
                      )}
                    {canContribute && (
                      <button
                        className="quiet"
                        disabled={busy}
                        onClick={() => {
                          setFollow(null);
                          setKind("check");
                          setRepeat(once);
                          setRepeatError("");
                          setAt("");
                          setTarget({
                            kind: "task",
                            id: t.id,
                            version: t.version,
                          });
                          setReminder(`Verificare: ${t.title}`);
                          openEditor(reminderEditor.current);
                        }}
                      >
                        {uiText("Aggiungi promemoria")}
                      </button>
                    )}
                    {canManage(t) && !closedTask(t) && (
                      <button
                        type="button"
                        className="quiet"
                        disabled={busy}
                        onClick={() => void updateStatus(t, "cancelled")}
                      >
                        {uiText("Annulla attività")}
                      </button>
                    )}
                    <TaskComments
                      workspace={workspace}
                      actor={actor}
                      taskId={t.id}
                      version={t.version}
                      active={openTaskIds.has(t.id)}
                      canContribute={canContribute}
                    />
                    <details className={styles.provenance}>
                      <summary>{uiText("Origine e riferimenti")}</summary>
                      <small>
                        {name(t.actor)} · {t.reason}
                        {t.candidateId
                          ? uiText(" · origine: proposta Emme")
                          : ""}
                      </small>
                      {t.references.map((r) => (
                        <p key={`${r.kind}${r.id}`}>
                          {r.kind} · {r.id}
                          {uiText(" · v")}
                          {r.version}
                          {r.kind === "commitment"
                            ? uiText(
                                " — obbligo separato, non modificato dal Task",
                              )
                            : ""}
                        </p>
                      ))}
                    </details>
                    {historyControl(t.id, "task")}
                    {view.proposals
                      .filter((p) => p.taskId === t.id)
                      .map((p) => (
                        <div key={p.id} data-prepared-id={p.id} tabIndex={-1}>
                          <p>
                            {uiText("Proposta di ")}
                            {name(p.actor)}: {p.content.title} ·{" "}
                            {p.content.dueAt ?? uiText("senza scadenza")}
                          </p>
                          <p>{p.content.description}</p>
                          {canContribute &&
                            t.responsible === actor &&
                            t.responsibleAvailable &&
                            !closedTask(t) &&
                            p.baseVersion === t.version && (
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
                                {uiText("Accetto il nuovo perimetro")}
                              </button>
                            )}
                        </div>
                      ))}
                  </div>
                </details>
                {canManage(t) && !closedTask(t) && (
                  <button
                    className={`quiet ${styles.quickComplete}`}
                    type="button"
                    aria-label={uiText(
                      "Segna come completata: {0}",
                      String(t.title),
                    )}
                    title={uiText("Segna come completata")}
                    disabled={busy}
                    onClick={() => void updateStatus(t, "completed")}
                  >
                    <WorkspaceIcon name="check" />
                  </button>
                )}
              </article>
            ))}
          {!!view?.suggestions.length && (
            <details className={styles.row}>
              <summary>
                {uiText("Proposte di Emme (")}
                {view.suggestions.length})
              </summary>
              {view.suggestions.map((s) => (
                <article key={s.id}>
                  <p>{s.content}</p>
                  <small>
                    {s.origin} · {s.qualification}
                  </small>
                  {canContribute && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        reset();
                        setContent({
                          ...empty,
                          title: s.subject,
                          description: s.content,
                        });
                        setCandidate(s.id);
                        openEditor(taskEditor.current);
                      }}
                    >
                      {uiText("Prepara un’attività dalla proposta")}
                    </button>
                  )}
                </article>
              ))}
            </details>
          )}
        </section>
      )}
      <section className={styles.group} aria-label={uiText("Promemoria")}>
        {!personal && <h2>{uiText("Promemoria")}</h2>}
        {canContribute && (
          <details
            ref={reminderEditor}
            className={`${styles.editor} ${styles.reminderEditor}`}
          >
            <summary>
              <WorkspaceIcon name={personal ? "plus" : "bell"} />{" "}
              {follow
                ? uiText("Rivedi promemoria")
                : uiText("Nuovo promemoria")}
            </summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (repeat.mode === "weekly" && !repeat.weekdays.length) {
                  setRepeatError("Scegli almeno un giorno della settimana.");
                  reminderEditor.current
                    ?.querySelector<HTMLInputElement>('input[type="checkbox"]')
                    ?.focus();
                  return;
                }
                const instant =
                  follow && dateField(follow.remindAt) === at
                    ? follow.remindAt
                    : new Date(at).toISOString();
                if (dateField(instant) !== at) {
                  setRepeatError(
                    "Questo orario non esiste nel fuso del dispositivo per il cambio dell’ora. Scegli un altro orario.",
                  );
                  return;
                }
                const value = {
                  content: reminder,
                  kind,
                  remindAt: instant,
                  timeZone: ruleZone,
                  recurrence: repeatRule(repeat),
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
                ).then((committed) => {
                  if (!committed) return;
                  setFollow((current) => (current === follow ? null : current));
                  setReminder((current) =>
                    current === reminder ? "" : current,
                  );
                  setAt((current) => (current === at ? "" : current));
                  setTarget((current) => (current === target ? null : current));
                  setKind("remember");
                  setRepeat(once);
                  setRepeatError("");
                  closeEditor(reminderEditor.current);
                });
              }}
            >
              <fieldset disabled={busy || !view}>
                <p className="hint">
                  {personal
                    ? uiText(
                        "Alla scadenza Emme te lo ricorda nella tua chat personale.",
                      )
                    : uiText(
                        "Alla scadenza Emme lo ricorda a tutti in chat. Chi ha attivato le notifiche può ricevere l’avviso anche sul dispositivo.",
                      )}
                </p>
                <label>
                  {uiText("Cosa vuoi ricordare?")}
                  <input
                    required
                    value={reminder}
                    onChange={(e) => setReminder(e.target.value)}
                  />
                </label>
                <label>
                  {repeat.mode === "once"
                    ? uiText("Quando")
                    : uiText("A partire da")}
                  <input
                    required
                    type="datetime-local"
                    value={at}
                    onChange={(e) => {
                      setAt(e.target.value);
                      setRepeatError("");
                    }}
                  />
                </label>
                <ReminderRepeatFields
                  draft={repeat}
                  onChange={(draft) => {
                    setRepeat(draft);
                    setRepeatError("");
                  }}
                  startDay={
                    deviceZone === ruleZone ? at.slice(0, 10) : undefined
                  }
                />
                {deviceZone !== ruleZone && (
                  <p className="hint">
                    {uiText("Inserisci data e ora nel fuso del dispositivo (")}
                    {deviceZone}
                    {uiText("). Il promemoria mantiene il fuso ")}
                    {ruleZone}
                    {uiText(", anche per la fine della serie.")}
                  </p>
                )}
                {repeatError && <p role="alert">{repeatError}</p>}
                <label>
                  {uiText("Tipo di promemoria")}
                  <select
                    value={kind}
                    onChange={(e) =>
                      setKind(e.target.value as FollowupItem["kind"])
                    }
                  >
                    {Object.entries(reminderKinds).map(([value, label]) => (
                      <option key={value} value={value}>
                        {uiText(label)}
                      </option>
                    ))}
                  </select>
                </label>
                {target && (
                  <p className="hint">
                    {uiText("Collegato a ")}
                    {linkedTask?.title ?? target.kind}
                    {uiText(" · v")}
                    {target.version}
                    {follow?.reference &&
                      follow.reference.version !== target.version && (
                        <>
                          {uiText(" (prima v")}
                          {follow.reference.version})
                        </>
                      )}
                  </p>
                )}
              </fieldset>
              <div className={styles.formActions}>
                <button disabled={busy || !view}>
                  {uiText("Salva promemoria")}
                </button>
                <button
                  className="quiet"
                  type="button"
                  disabled={busy}
                  onClick={cancelReminder}
                >
                  {uiText("Annulla")}
                </button>
              </div>
            </form>
          </details>
        )}
        {view && !view.followups.length && (
          <p className="hint">
            {before || view.next
              ? uiText("Nessun promemoria in questa pagina.")
              : uiText("Non ci sono ancora promemoria.")}
          </p>
        )}
        {view &&
          reminders
            .filter((f) => !mine || f.owner === actor)
            .map((f) => (
              <details
                className={styles.row}
                data-schedule-id={f.id}
                key={f.id}
              >
                <summary>
                  <strong>{f.content}</strong>
                  <span>
                    {uiText(reminderState(f))}
                    {" · "}
                    {reminderTime(f)
                      ? localDate(uiLocale).format(new Date(reminderTime(f)!))
                      : uiText("Nessun altro avviso in programma")}
                    {!personal && (
                      <>
                        {" · "}
                        {f.owner === actor
                          ? uiText("Creato da te")
                          : uiText("Creato da {0}", String(name(f.owner)))}
                      </>
                    )}
                  </span>
                </summary>
                {f.recurrence && <p>{describeRepeat(f, uiLocale)}</p>}
                <p>
                  {uiText(reminderKinds[f.kind])}
                  {uiText(" · versione ")}
                  {f.version}
                </p>
                {f.status === "active" && (
                  <p>
                    {f.needsReview
                      ? uiText("Da rivedere: accesso o riferimento cambiato")
                      : f.deliveredAt
                        ? uiText("Promemoria scattato")
                        : f.recurrence && !f.nextRemindAt
                          ? uiText("Ultima ricorrenza raggiunta")
                          : uiText("In attesa")}
                  </p>
                )}
                {canContribute && f.owner === actor && (
                  <>
                    {f.recurrence && f.status === "active" && (
                      <p className="hint">
                        {uiText(
                          "Concludendo o annullando la serie interrompi i prossimi avvisi.",
                        )}
                      </p>
                    )}
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() => {
                        setFollow(f);
                        setReminder(f.content);
                        setKind(f.kind);
                        setAt(dateField(f.remindAt));
                        setRepeat(repeatDraft(f.recurrence));
                        setRepeatError("");
                        openEditor(reminderEditor.current);
                        setTarget(
                          f.reference?.kind === "task"
                            ? {
                                ...f.reference,
                                version:
                                  view.tasks.find(
                                    (t) => t.id === f.reference?.id,
                                  )?.version ?? f.reference.version,
                              }
                            : f.reference,
                        );
                      }}
                    >
                      {f.status === "active"
                        ? uiText("Modifica promemoria")
                        : uiText("Riprogramma promemoria")}
                    </button>
                    <button
                      disabled={busy || f.status === "done"}
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
                      {f.recurrence
                        ? uiText("Concludi la serie")
                        : uiText("Segna come concluso")}
                    </button>
                    <button
                      className="quiet"
                      disabled={busy || f.status === "cancelled"}
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
                      {f.recurrence
                        ? uiText("Annulla la serie")
                        : uiText("Annulla promemoria")}
                    </button>
                  </>
                )}
                {historyControl(f.id, "followup")}
              </details>
            ))}
      </section>
      {view?.next && (
        <button onClick={() => setBefore(view.next)}>
          {uiText("Altri elementi")}
        </button>
      )}
      {before && (
        <button onClick={() => setBefore(null)}>
          {uiText("Torna ai primi elementi")}
        </button>
      )}
      {!personal && <ProductHelp screen="tasks" />}
    </section>
  );
}
