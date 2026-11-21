import { useUiLanguage } from "../i18n";
import React, { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import type {
  TasksView,
  TaskItem,
  TaskContent,
  taskCommentsSchema,
} from "../../../src/contracts/tasks";
import type { z } from "zod";
import type { NativeRequest } from "../api";
import { ToolRow } from "./ToolLayout";
import {
  reminderState,
  reminderTime,
  sortedReminders,
} from "../../../src/shared/followup-order";
import { Action, Field, usePalette } from "../ui";
import { useResource } from "../useResource";
import type { Commands } from "./useCommands";
import type { workspaceScheduleSchema } from "../../../src/contracts/agenda";
import { localDay } from "../integrations/inputs";
import { DateField } from "../DateField";
import { TaskRevision } from "./TaskRevision";
import { FollowupDetail } from "./FollowupDetail";
import type { ScheduleSubmit as Submit } from "./schedule-actions";

const statusNames: Record<TaskItem["status"], string> = {
  open: "Aperto",
  in_progress: "In corso",
  standby: "In pausa",
  completed: "Completato",
  cancelled: "Annullato",
};
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
type Props = {
  request: NativeRequest;
  path: string;
  actorId: string;
  commands: Commands;
  canWrite: boolean;
  revision: string;
  personal?: boolean;
  focusId?: string;
  prepareTask?: boolean;
};

export function Schedule({
  request,
  path,
  actorId,
  commands,
  canWrite,
  revision,
  personal = false,
  focusId,
  prepareTask,
}: Props) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const [page, setPage] = useState<string | null>(null);
  const [focus, setFocus] = useState(focusId);
  const [mine, setMine] = useState(false),
    [limit, setLimit] = useState(3);
  const upcoming = useResource<z.infer<typeof workspaceScheduleSchema>>(
    request,
    path + "/schedule?mine=" + mine + "&limit=" + (limit + 1),
    15000,
    !personal,
  );
  const view = useResource<TasksView>(
    request,
    path +
      "/tasks" +
      (focus
        ? "?focus=" + encodeURIComponent(focus)
        : page
          ? "?before=" + encodeURIComponent(page)
          : ""),
    0,
  );
  const [mode, setMode] = useState<"task" | "reminder" | null>(
    prepareTask && !personal ? "task" : null,
  );
  const [text, setText] = useState("");
  const [when, setWhen] = useState(() => new Date(Date.now() + 3600000));
  const [until, setUntil] = useState<Date | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [repeat, setRepeat] = useState<"once" | "daily" | "weekly">("once");
  const [person, setPerson] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  const refreshData = view.refresh,
    refreshSchedule = upcoming.refresh;
  useEffect(() => {
    refreshData();
    refreshSchedule();
  }, [revision, refreshData, refreshSchedule]);
  const members = view.value?.members ?? [];
  const label = (id: string | null) =>
    members.find((m) => m.id === id)?.name ?? "Non assegnato";
  const disabled =
    !canWrite || !commands.ready || commands.working || !!commands.pending;
  const send: Submit = (label, command) => {
    return commands.send({ kind: "command", command, label });
  };
  async function create() {
    setError("");
    const content = text.trim();
    if (!content || !mode || (personal && mode === "task")) return;
    if (mode === "reminder") {
      if (repeat !== "once" && until && localDay(until) < localDay(when)) {
        setError(uiText("La data di fine deve includere la prima scadenza."));
        return;
      }
      if (+when <= Date.now() || (repeat === "weekly" && !days.length)) {
        setError(
          uiText("Scegli una scadenza futura e i giorni di ripetizione."),
        );
        return;
      }
      const sent = await send("Crea promemoria", {
        type: "followup.create",
        kind: "remember",
        content,
        remindAt: when.toISOString(),
        timeZone: zone(),
        reference: null,
        recurrence:
          repeat === "once"
            ? null
            : {
                weekdays: repeat === "daily" ? [1, 2, 3, 4, 5, 6, 7] : days,
                ...(until ? { until: localDay(until) } : {}),
              },
      });
      if (sent) setMode(null);
    } else {
      const sent = await send("Crea attività", {
        type: "task.create",
        content: {
          title: content,
          description: "",
          timeZone: zone(),
          dueAt: null,
          suggestedPerson: person,
          references: [],
        },
      });
      if (sent) setMode(null);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      {personal && (
        <Text style={{ color: p.muted }}>
          {uiText(
            "I promemoria e i richiami restano nella tua area personale.",
          )}
        </Text>
      )}
      {!view.value && !view.error && (
        <Text style={{ color: p.muted }}>
          {personal
            ? uiText("Caricamento dei promemoria…")
            : uiText("Caricamento di attività e promemoria…")}
        </Text>
      )}
      {view.error && (
        <>
          <Text style={{ color: p.text }}>{view.error}</Text>
          <Action label={uiText("Ricarica attività")} onPress={view.refresh} />
        </>
      )}
      {!focus && !personal && (
        <>
          <Text
            accessibilityRole="header"
            style={{ color: p.text, fontSize: 19, fontWeight: "700" }}
          >
            {uiText("Prossime scadenze")}
          </Text>
          <Action
            variant={mine ? "selected" : "quiet"}
            label={uiText("Solo mie")}
            onPress={() => {
              setMine(!mine);
              setLimit(3);
            }}
          />
          {!!upcoming.error && (
            <Action
              label={uiText("Ricarica scadenze · {0}", String(upcoming.error))}
              onPress={upcoming.refresh}
            />
          )}
          {upcoming.value?.entries
            .filter((e) => e.at)
            .slice(0, limit)
            .map((e) => (
              <ToolRow
                key={e.id}
                label={new Date(e.at!).toLocaleString(locale) + " · " + e.title}
                onPress={() => {
                  setFocus(e.id);
                  setSelected(e.id);
                  setMode(null);
                }}
              />
            ))}
          {upcoming.value && !upcoming.value.entries.some((e) => e.at) && (
            <Text style={{ color: p.muted }}>
              {uiText("Nessuna scadenza in programma.")}
            </Text>
          )}
          {upcoming.value &&
            upcoming.value.entries.filter((e) => e.at).length > limit &&
            limit < 499 && (
              <Action
                label={uiText("Carica altre scadenze")}
                onPress={() => setLimit(Math.min(limit + 12, 499))}
              />
            )}
        </>
      )}
      {focus && (
        <Action
          label={uiText("‹ Tutte le attività")}
          onPress={() => {
            setSelected(null);
            setFocus(undefined);
          }}
        />
      )}
      {canWrite && !focus && (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {!personal && (
            <Action
              label={uiText("Nuova attività")}
              onPress={() => {
                setMode(mode === "task" ? null : "task");
                setText("");
                setError("");
              }}
            />
          )}
          <Action
            label={uiText("Nuovo promemoria")}
            icon="plus"
            primary={personal && !mode}
            onPress={() => {
              setMode(mode === "reminder" ? null : "reminder");
              setText("");
              setError("");
            }}
          />
        </View>
      )}
      {mode && (
        <>
          <Field
            label={
              mode === "task"
                ? uiText("Cosa c’è da fare?")
                : uiText("Cosa vuoi ricordare?")
            }
            value={text}
            maxLength={mode === "task" ? 160 : 2000}
            onChangeText={setText}
          />
          {mode === "task" ? (
            <>
              <Text style={{ color: p.muted }}>
                {uiText("Proponi a una persona. Sarà lei ad accettare.")}
              </Text>
              <View style={{ gap: 4, flexWrap: "wrap", flexDirection: "row" }}>
                {[{ id: null, name: "Nessuno" }, ...members].map((m) => (
                  <Action
                    key={m.id ?? "none"}
                    label={m.name}
                    primary={person === m.id}
                    onPress={() => setPerson(m.id)}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              <DateField
                label={uiText("Quando · {0}", String(zone()))}
                value={when}
                change={setWhen}
              />
              <View style={{ gap: 4, flexDirection: "row", flexWrap: "wrap" }}>
                {(["once", "daily", "weekly"] as const).map((r, i) => (
                  <Action
                    key={r}
                    label={["Una volta", "Ogni giorno", "Scegli i giorni"][i]}
                    primary={r === repeat}
                    onPress={() => setRepeat(r)}
                  />
                ))}
              </View>
              {repeat === "weekly" && (
                <View
                  style={{ gap: 4, flexWrap: "wrap", flexDirection: "row" }}
                >
                  {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map(
                    (label, i) => (
                      <Action
                        key={label}
                        label={label}
                        primary={days.includes(i + 1)}
                        onPress={() =>
                          setDays((d) =>
                            d.includes(i + 1)
                              ? d.filter((n) => n !== i + 1)
                              : [...d, i + 1].sort(),
                          )
                        }
                      />
                    ),
                  )}
                </View>
              )}
              {repeat !== "once" && (
                <>
                  <Action
                    label={
                      until
                        ? uiText("Nessuna data di fine")
                        : uiText("Imposta data di fine")
                    }
                    variant="quiet"
                    onPress={() => setUntil(until ? null : new Date(when))}
                  />
                  {until && (
                    <DateField
                      dateOnly
                      label={uiText("Fine inclusa")}
                      value={until}
                      change={setUntil}
                    />
                  )}
                </>
              )}
              <Text style={{ color: p.muted }}>
                {personal
                  ? uiText(
                      "Alla scadenza Emme te lo ricorda nella tua chat personale.",
                    )
                  : uiText(
                      "Alla scadenza Emme lo ricorda a tutti in chat. Chi ha attivato le notifiche può ricevere l’avviso anche sul dispositivo.",
                    )}
              </Text>
            </>
          )}
          {!!error && <Text style={{ color: p.text }}>{error}</Text>}
          <Action
            label={
              mode === "task"
                ? uiText("Crea attività")
                : uiText("Imposta promemoria")
            }
            primary
            disabled={disabled || !text.trim()}
            onPress={create}
          />
          <Action
            label={uiText("Chiudi modulo")}
            onPress={() => setMode(null)}
          />
        </>
      )}
      {!personal &&
        view.value?.tasks
          .filter(
            (t) =>
              focus ||
              !mine ||
              (t.responsible === actorId && t.responsibleAvailable),
          )
          .map((t) => (
            <View
              key={t.id}
              style={{
                gap: 5,
                borderTopWidth: 1,
                borderTopColor: p.line,
                paddingVertical: 9,
              }}
            >
              <Action
                label={t.title + " · " + uiText(statusNames[t.status])}
                onPress={() => setSelected(t.id === selected ? null : t.id)}
              />
              <Text style={{ color: p.muted }}>
                {t.responsible
                  ? label(t.responsible)
                  : t.suggestedPerson
                    ? uiText("Proposta a {0}", String(label(t.suggestedPerson)))
                    : uiText("Non assegnato")}
                {t.dueAt
                  ? " · " + new Date(t.dueAt).toLocaleString(locale)
                  : ""}
              </Text>
              {selected === t.id && (
                <TaskDetail
                  key={t.id + "." + t.version}
                  task={t}
                  actorId={actorId}
                  disabled={disabled}
                  request={request}
                  path={path}
                  send={send}
                  members={members}
                  proposals={view.value?.proposals ?? []}
                />
              )}
            </View>
          ))}
      {sortedReminders(view.value?.followups ?? [])
        .filter((f) => focus || !mine || f.owner === actorId)
        .map((f) => (
          <View
            key={f.id}
            style={{
              paddingVertical: 8,
              borderTopWidth: 1,
              borderTopColor: p.line,
              gap: 3,
            }}
          >
            <ToolRow
              expanded={selected === f.id}
              label={f.content}
              onPress={() => setSelected(selected === f.id ? null : f.id)}
            />
            <Text style={{ color: p.muted }}>
              {uiText(reminderState(f))} ·{" "}
              {reminderTime(f)
                ? new Date(reminderTime(f)!).toLocaleString(locale)
                : uiText("Nessuna prossima scadenza")}
              {f.recurrence ? uiText(" · ricorrente") : ""}
            </Text>
            {selected === f.id && (
              <FollowupDetail
                key={f.id + "." + f.version + "." + f.nextRemindAt}
                f={f}
                actor={actorId}
                disabled={disabled}
                send={send}
              />
            )}
          </View>
        ))}
      {view.value &&
        (personal || !view.value.tasks.length) &&
        !view.value.followups.length && (
          <Text style={{ color: p.muted }}>
            {personal
              ? uiText("Nessun promemoria personale.")
              : uiText("Nessuna attività o promemoria in programma.")}
          </Text>
        )}
      {view.value?.next && (
        <Action
          label={uiText("Pagina successiva")}
          onPress={() => setPage(view.value!.next)}
        />
      )}
      {page && (
        <Action
          label={uiText("Torna alle più recenti")}
          onPress={() => setPage(null)}
        />
      )}
    </View>
  );
}
function TaskDetail({
  task: t,
  disabled,
  actorId,
  request,
  path,
  send,
  members,
  proposals,
}: {
  task: TaskItem;
  disabled: boolean;
  actorId: string;
  request: NativeRequest;
  path: string;
  send: Submit;
  members: TasksView["members"];
  proposals: TasksView["proposals"];
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const [body, setBody] = useState("");
  const [showPeople, people] = useState(false);
  const comments = useResource<z.infer<typeof taskCommentsSchema>>(
    request,
    path + "/task-comments?taskId=" + t.id,
    15000,
  );
  const base = { taskId: t.id, expectedVersion: t.version };
  const closed = t.status === "completed" || t.status === "cancelled";
  return (
    <View style={{ gap: 7, paddingLeft: 8 }}>
      {!!t.description && (
        <Text style={{ color: p.text }}>{t.description}</Text>
      )}
      {!closed &&
        !t.responsible &&
        (!t.suggestedPerson ||
          (t.suggestedPerson === actorId && !t.declinedBy)) && (
          <Action
            label={uiText("Accetta responsabilità")}
            disabled={disabled}
            onPress={() =>
              send("Accetta attività", {
                type: "task.accept",
                ...base,
                representSelf: true,
                reason: "Accettazione personale della versione " + t.version,
              })
            }
          />
        )}
      {!closed &&
        !t.responsible &&
        t.suggestedPerson === actorId &&
        !t.declinedBy && (
          <Action
            label={uiText("Rifiuta proposta")}
            disabled={disabled}
            onPress={() =>
              send("Rifiuta attività", {
                type: "task.decline",
                ...base,
                reason: "Proposta rifiutata dalla persona indicata",
              })
            }
          />
        )}
      {!closed && t.responsible === actorId && (
        <Action
          label={uiText("Lascia responsabilità")}
          disabled={disabled}
          onPress={() =>
            Alert.alert(
              uiText("Lasciare la responsabilità di questa attività?"),
              uiText("L’attività resterà nello spazio."),
              [
                { text: uiText("Annulla"), style: "cancel" },
                {
                  text: uiText("Lascia"),
                  onPress: () =>
                    send("Lascia attività", {
                      type: "task.relinquish",
                      ...base,
                      reason: "Rinuncia personale alla responsabilità",
                      representSelf: true,
                    }),
                },
              ],
            )
          }
        />
      )}
      {!closed && !t.responsible && (
        <Action
          label={uiText("Proponi assegnazione")}
          disabled={disabled}
          onPress={() => people(!showPeople)}
        />
      )}
      {showPeople &&
        members.map((m) => (
          <Action
            key={m.id}
            label={m.name}
            disabled={disabled}
            onPress={() => {
              const content: TaskContent = {
                title: t.title,
                description: t.description,
                dueAt: t.dueAt,
                timeZone: t.timeZone,
                suggestedPerson: m.id,
                references: t.references,
              };
              send("Proponi assegnazione", {
                type: "task.revise",
                ...base,
                content,
                reason: "Proposta di assegnazione",
              });
            }}
          />
        ))}
      {!closed &&
        (!t.responsible ||
          (t.responsible === actorId && t.responsibleAvailable)) && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            {(["in_progress", "standby", "completed"] as const)
              .filter((s) => s !== t.status)
              .map((s) => (
                <Action
                  key={s}
                  label={
                    s === "completed"
                      ? uiText("Completa")
                      : uiText(statusNames[s])
                  }
                  disabled={disabled}
                  onPress={() =>
                    send(uiText(statusNames[s]), {
                      type: "task.status",
                      ...base,
                      status: s,
                      reason: "Aggiornamento operativo dell’attività",
                      noNormativeEffect: true,
                    })
                  }
                />
              ))}
          </View>
        )}
      {!closed && (
        <TaskRevision
          task={t}
          members={members}
          proposals={proposals}
          disabled={disabled}
          actorId={actorId}
          send={send}
        />
      )}
      {closed &&
        (!t.responsible ||
          (t.responsible === actorId && t.responsibleAvailable)) && (
          <Action
            label={uiText("Riapri attività")}
            disabled={disabled}
            onPress={() =>
              send("Riapri attività", {
                type: "task.status",
                ...base,
                status: "open",
                reason: "Riapertura operativa dell’attività",
                noNormativeEffect: true,
              })
            }
          />
        )}
      {comments.error && (
        <Text style={{ color: p.muted }}>{comments.error}</Text>
      )}
      {comments.value?.comments.map((c) => (
        <Text key={c.id} style={{ color: p.text }}>
          {c.authorName} · {c.body}
        </Text>
      ))}
      <Field
        label={uiText("Commento")}
        multiline
        maxLength={2000}
        value={body}
        onChangeText={setBody}
      />
      <Action
        label={uiText("Invia commento")}
        disabled={disabled || !body.trim()}
        onPress={async () => {
          const sent = await send("Commenta attività", {
            type: "task.comment",
            ...base,
            body: body.trim(),
          });
          if (sent) {
            setBody((current) => (current === body ? "" : current));
            comments.refresh();
          }
        }}
      />
    </View>
  );
}
