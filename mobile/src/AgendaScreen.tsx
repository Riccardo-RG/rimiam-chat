import { useUiLanguage } from "./i18n";
import { ShellHeading } from "./AppShell";
import { ChoiceStrip, ToolRow } from "./workspace/ToolLayout";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { DateField } from "./DateField";
import type { AgendaView } from "../../src/contracts/agenda";
import type { Command } from "../../src/contracts/commands";
import type { ConversationDirectoryEntry } from "../../src/contracts/conversation-reading";
import type { HomeProps } from "./AppHome";
import { post, problem } from "./api";
import { Action, Field, usePalette } from "./ui";
import { useResource } from "./useResource";
import { useCommands } from "./workspace/useCommands";
import { PendingStrip } from "./workspace/PendingStrip";
import { Panel } from "./workspace/SharedFiles";
import { IntegrationsScreen } from "./integrations/IntegrationsScreen";
type Item = AgendaView["items"][number];
type Kind = "reminder" | "event";
export type AgendaStart = { target: string; kind: Kind | "calendar" };
type Props = HomeProps & {
  open: (id: string, name: string) => void;
  onOpenNavigation?: () => void;
  start?: AgendaStart;
};
const dayKey = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
export function agendaPath(
  day: Date,
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
) {
  return (
    "/api/v1/agenda?day=" + dayKey(day) + "&zone=" + encodeURIComponent(zone)
  );
}
type Editor = { target: string; kind: Kind; item?: Item };
export function AgendaScreen(props: Props) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const { request, user } = props,
    c = usePalette();
  const [day, setDay] = useState(() => new Date()),
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const agenda = useResource<AgendaView>(request, agendaPath(day, zone), 60000);
  const start = props.start;
  const [editor, setEditor] = useState<Editor | null>(
      start && start.kind !== "calendar"
        ? { target: start.target, kind: start.kind }
        : null,
    ),
    [cal, setCal] = useState<string | null>(
      start?.kind === "calendar" ? start.target : null,
    ),
    [filter, setFilter] = useState<"all" | "personal" | "group">("all");
  const [chosen, setChosen] = useState<string | null>(null),
    [older, setOlder] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const finish = () => {
    setEditor(null);
    setChosen(null);
    agenda.refresh();
  };
  async function launch(which: Kind | "calendar") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const archive = await request<{ id: string }>(
        "/api/v1/personal-space",
        post({ expectedActorId: user.id }),
      );
      if (which === "calendar") setCal(archive.id);
      else setEditor({ target: archive.id, kind: which });
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  if (cal)
    return (
      <IntegrationsScreen
        request={request}
        actorId={user.id}
        origin={props.origin}
        email={user.email}
        workspaceId={cal}
        name="Calendari personali"
        kind="calendar"
        canContribute
        personal
        onBack={() => {
          setCal(null);
          agenda.refresh();
        }}
      />
    );
  if (editor)
    return (
      <AgendaEditor
        {...props}
        key={editor.target + editor.kind}
        editor={editor}
        day={day}
        zone={zone}
        done={finish}
      />
    );
  const v = agenda.value;
  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }}>
      <ShellHeading title={uiText("Oggi")} menu={props.onOpenNavigation} />
      <DateField
        dateOnly
        label={uiText("Giornata")}
        value={day}
        change={setDay}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Action
          label={uiText("Nuovo promemoria")}
          icon="plus"
          disabled={busy}
          onPress={() => void launch("reminder")}
        />
        <Action
          label={uiText("Nuovo appuntamento")}
          icon="calendar"
          disabled={busy}
          onPress={() => void launch("event")}
        />
        <Action
          label={
            v?.hasLinkedCalendar
              ? uiText("Calendari collegati")
              : uiText("Collega calendario")
          }
          disabled={busy}
          onPress={() => void launch("calendar")}
        />
      </View>
      <ChoiceStrip
        label={uiText("Filtra agenda")}
        choices={["Tutto", "Solo io", "Spazi"]}
        value={
          filter === "all"
            ? "Tutto"
            : filter === "personal"
              ? "Solo io"
              : "Spazi"
        }
        onSelect={(f) =>
          setFilter(
            f === "Tutto" ? "all" : f === "Solo io" ? "personal" : "group",
          )
        }
      />
      {v &&
        !v.items.some(
          (i) => filter === "all" || i.personal === (filter === "personal"),
        ) && (
          <Text style={{ color: c.muted }}>
            {uiText("Nessun impegno per questa giornata.")}
          </Text>
        )}
      {v?.items
        .filter(
          (i) => filter === "all" || i.personal === (filter === "personal"),
        )
        .map((i) => (
          <View
            key={i.id + i.at}
            style={{
              paddingVertical: 8,
              borderBottomColor: c.line,
              borderBottomWidth: 1,
              gap: 7,
            }}
          >
            <ToolRow
              expanded={chosen === i.id}
              label={
                new Date(i.at).toLocaleTimeString(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                }) +
                "  " +
                i.title
              }
              onPress={() => setChosen(chosen === i.id ? null : i.id)}
            />
            <Text style={{ color: c.muted }}>
              {i.personal ? uiText("Solo io") : i.workspaceName}
              {i.rsvp === "pending" ? uiText(" · Da confermare") : ""}
            </Text>
            {chosen === i.id && (
              <RowActions
                {...props}
                target={i.workspaceId}
                done={finish}
                actions={
                  i.kind === "event"
                    ? i.rsvp === "pending"
                      ? [
                          [
                            "Accetta",
                            {
                              type: "temporal.respond",
                              eventId: i.id,
                              expectedVersion: i.version,
                              response: "accepted",
                            },
                          ],
                          [
                            "Rifiuta",
                            {
                              type: "temporal.respond",
                              eventId: i.id,
                              expectedVersion: i.version,
                              response: "declined",
                            },
                          ],
                        ]
                      : []
                    : [
                        [
                          i.personal ? "Archivia" : "Nascondi per me",
                          {
                            type: "followup.occurrence",
                            followupId: i.id,
                            expectedVersion: i.version,
                            scheduledAt: i.at,
                            action: i.personal ? "close" : "hide",
                          },
                        ],
                        ...(!i.personal && i.owner === user.id
                          ? [
                              [
                                "Chiudi per tutti",
                                {
                                  type: "followup.occurrence",
                                  followupId: i.id,
                                  expectedVersion: i.version,
                                  scheduledAt: i.at,
                                  action: "close",
                                },
                              ] as Choice,
                            ]
                          : []),
                      ]
                }
              />
            )}
            {chosen === i.id &&
              i.kind === "reminder" &&
              i.owner === user.id && (
                <Action
                  label={uiText("Modifica promemoria")}
                  onPress={() =>
                    setEditor({
                      target: i.workspaceId,
                      kind: "reminder",
                      item: i,
                    })
                  }
                />
              )}
          </View>
        ))}
      {!!v &&
        !v.items.some(
          (i) => filter === "all" || i.personal === (filter === "personal"),
        ) && (
          <Text style={{ color: c.muted }}>
            {uiText("Nessun impegno per questa giornata.")}
          </Text>
        )}
      {!!v?.previous.length && (
        <Action
          label={uiText(
            "Promemoria precedenti · {0}",
            String(v.previous.length),
          )}
          onPress={() => setOlder(!older)}
        />
      )}
      {older &&
        v?.previous.map((p) => (
          <PreviousReminder
            {...props}
            key={p.id}
            previous={p}
            before={v.before}
            zone={zone}
            done={finish}
          />
        ))}
      {!!v?.offers.length && (
        <Text style={{ color: c.text, fontWeight: "700" }}>
          {uiText("In attesa di te")}
        </Text>
      )}
      {v?.offers.map((o) => (
        <View key={o.id} style={{ gap: 6 }}>
          <Action
            label={o.title + " · " + o.workspaceName}
            onPress={() => setChosen(chosen === o.id ? null : o.id)}
          />
          {chosen === o.id && (
            <>
              <Text style={{ color: c.text }}>{o.description}</Text>
              <RowActions
                {...props}
                target={o.workspaceId}
                done={finish}
                actions={[
                  [
                    "Accetta incarico",
                    {
                      type: "task.accept",
                      taskId: o.id,
                      expectedVersion: o.version,
                      reason: "Accettazione personale dalla Home",
                      representSelf: true,
                    },
                  ],
                  [
                    "Rifiuta incarico",
                    {
                      type: "task.decline",
                      taskId: o.id,
                      expectedVersion: o.version,
                      reason: "Proposta rifiutata dalla Home",
                    },
                  ],
                ]}
              />
            </>
          )}
        </View>
      ))}
      {!v && !agenda.error && (
        <Text style={{ color: c.muted }}>{uiText("Caricamento agenda…")}</Text>
      )}
      {!!(error || agenda.error) && (
        <>
          <Text accessibilityRole="alert" style={{ color: c.text }}>
            {error || agenda.error}
          </Text>
          <Action label={uiText("Riprova")} onPress={agenda.refresh} />
        </>
      )}
    </ScrollView>
  );
}
function PreviousReminder({
  previous: p,
  before,
  zone,
  done,
  ...props
}: Props & {
  previous: AgendaView["previous"][number];
  before: string;
  zone: string;
  done: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const colors = usePalette(),
    [choosing, choose] = useState(false),
    [when, setWhen] = useState(() => new Date(Date.now() + 15 * 60000));
  if (!p.personal) return null;
  const editable =
    Date.now() < when.getTime() &&
    dayKey(when) === dayKey(new Date()) &&
    dayKey(new Date(before)) === dayKey(new Date());
  const base = {
    type: "followup.previous" as const,
    followupId: p.id,
    before,
    timeZone: zone,
  };
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: colors.text }}>
        {p.title} · {p.count}
        {uiText(" scadenze")}
      </Text>
      <Action
        label={choosing ? uiText("Chiudi orario") : uiText("Ricordamelo oggi")}
        onPress={() => choose(!choosing)}
      />
      {choosing && (
        <>
          <DateField
            label={uiText("Orario di oggi")}
            timeOnly
            value={when}
            change={(t) => {
              const date = new Date();
              date.setHours(t.getHours(), t.getMinutes(), 0, 0);
              setWhen(date);
            }}
          />
          {!editable && (
            <Text style={{ color: colors.muted }}>
              {uiText("Scegli un orario futuro di oggi.")}
            </Text>
          )}
        </>
      )}
      <RowActions
        {...props}
        target={p.workspaceId}
        done={done}
        actions={[
          ...(choosing && editable
            ? [
                [
                  "Conferma orario",
                  {
                    ...base,
                    action: "remind_today",
                    remindAt: when.toISOString(),
                  },
                ] as Choice,
              ]
            : []),
          ["Archivia precedenti", { ...base, action: "archive" }],
        ]}
      />
    </View>
  );
}
type Choice = [string, Command];
function RowActions({
  request,
  user,
  origin,
  target,
  done,
  actions,
}: Props & { target: string; done: () => void; actions: Choice[] }) {
  const { t: uiText } = useUiLanguage();
  const scope = useMemo(
    () => ({ origin, actorId: user.id, workspaceId: target }),
    [origin, user.id, target],
  );
  const ctl = useCommands(request, scope, done);
  return (
    <>
      <PendingStrip commands={ctl} />
      {actions.map(([label, command]) => (
        <Action
          label={label}
          key={label}
          disabled={!ctl.ready || ctl.working || !!ctl.pending}
          onPress={() => {
            const send = () =>
              void ctl.send({ kind: "command", label, command });
            if (label === "Chiudi per tutti")
              Alert.alert(
                label,
                uiText("Il richiamo verrà chiuso per questa scadenza."),
                [
                  { text: uiText("Annulla"), style: "cancel" },
                  { text: uiText("Chiudi per tutti"), onPress: send },
                ],
              );
            else send();
          }}
        />
      ))}
    </>
  );
}
function AgendaEditor({
  request,
  user,
  origin,
  editor,
  zone,
  done,
  day,
}: Props & { editor: Editor; day: Date; zone: string; done: () => void }) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    i = editor.item;
  const rooms = useResource<{ workspaces: ConversationDirectoryEntry[] }>(
    request,
    "/api/v1/workspaces",
  );
  const [target, setTarget] = useState(editor.target),
    [label, setLabel] = useState(i?.title ?? "");
  const [choosingTarget, setChoosingTarget] = useState(false);
  const [roomFilter, setRoomFilter] = useState("");
  const [start, setStart] = useState(() =>
    i
      ? new Date(i.at)
      : new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          new Date().getHours() + 1,
        ),
  );
  const [end, setEnd] = useState(() => new Date(+start + 3600000)),
    [following, setFollowing] = useState(false);
  const [rule, setRule] = useState<"once" | "daily" | "weekly">("once"),
    [days, setDays] = useState<number[]>([]);
  const [audience, setAudience] = useState<"all" | "calendar" | "people">(
      "calendar",
    ),
    [people, setPeople] = useState<string[]>([]);
  const directory = useResource<{
    contextRevision: number;
    members: { id: string; name: string }[];
  }>(request, "/api/v1/agenda/destination?workspace=" + target);
  const scope = useMemo(
    () => ({ origin, actorId: user.id, workspaceId: target }),
    [origin, user.id, target],
  );
  const ctl = useCommands(request, scope, done);
  const [error, setError] = useState("");
  useEffect(() => {
    setPeople([]);
    setAudience("calendar");
  }, [target]);
  const workspaceOptions = rooms.value?.workspaces ?? [];
  const visibleRooms = workspaceOptions.filter(
    (w) =>
      w.id !== editor.target &&
      w.name
        .toLocaleLowerCase()
        .includes(roomFilter.trim().toLocaleLowerCase()),
  );
  const targetName =
    target === editor.target
      ? "Solo io"
      : (workspaceOptions.find((w) => w.id === target)?.name ??
        "Spazio selezionato");
  function choose(id: string) {
    setTarget(id);
    setChoosingTarget(false);
  }
  function save() {
    setError("");
    if (editor.kind === "reminder" && start.getTime() <= Date.now()) {
      setError(uiText("Scegli un orario futuro per il promemoria."));
      return;
    }
    const title = label.trim(),
      at = start.toISOString(),
      d = directory.value;
    if (!title || !d) return;
    let command: Command;
    if (i) {
      command = {
        type: "followup.occurrence",
        followupId: i.id,
        expectedVersion: i.version,
        scheduledAt: i.at,
        action: following ? "replace_following" : "replace",
        replacement: { content: title, remindAt: at, timeZone: zone },
      };
    } else if (editor.kind === "reminder") {
      if (rule === "weekly" && !days.length) {
        setError(uiText("Scegli almeno un giorno."));
        return;
      }
      command = {
        type: "followup.create",
        kind: "remember",
        content: title,
        remindAt: at,
        timeZone: zone,
        reference: null,
        recurrence:
          rule === "once"
            ? null
            : { weekdays: rule === "daily" ? [1, 2, 3, 4, 5, 6, 7] : days },
      };
    } else {
      if (end <= start) {
        setError(uiText("La fine deve essere successiva all’inizio."));
        return;
      }
      if (audience === "people" && !people.length) {
        setError(uiText("Scegli almeno una persona."));
        return;
      }
      command = {
        type: "temporal.create",
        representSelf: true,
        reason: "Appuntamento creato dalla Home",
        expectedContextRevision: d.contextRevision,
        payload: { title, start: at, end: end.toISOString(), timeZone: zone },
        audience:
          audience === "people"
            ? { kind: "people", people }
            : { kind: audience },
      };
    }
    void ctl.send({ kind: "command", label: title, command });
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 18, gap: 12 }}
    >
      <Action label={uiText("‹ Oggi")} onPress={done} />
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 24 }}>
        {i
          ? uiText("Modifica promemoria")
          : editor.kind === "event"
            ? uiText("Nuovo appuntamento")
            : uiText("Nuovo promemoria")}
      </Text>
      {!i && (
        <>
          <Action
            label={uiText("Dove · {0}  ›", String(targetName))}
            disabled={ctl.working || !!ctl.pending}
            onPress={() => {
              setRoomFilter("");
              setChoosingTarget(true);
            }}
          />
          {choosingTarget && (
            <Panel
              title={uiText("Scegli dove")}
              onClose={() => setChoosingTarget(false)}
            >
              <Field
                label={uiText("Cerca uno spazio")}
                value={roomFilter}
                onChangeText={setRoomFilter}
              />
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: 8 }}
              >
                <Action
                  label={uiText("Solo io")}
                  primary={target === editor.target}
                  onPress={() => choose(editor.target)}
                />
                {visibleRooms.map((w) => (
                  <Action
                    key={w.id}
                    label={w.name}
                    primary={target === w.id}
                    onPress={() => choose(w.id)}
                  />
                ))}
                {rooms.error ? (
                  <>
                    <Text accessibilityRole="alert" style={{ color: c.text }}>
                      {rooms.error}
                    </Text>
                    <Action label={uiText("Riprova")} onPress={rooms.refresh} />
                  </>
                ) : !rooms.value ? (
                  <Text style={{ color: c.muted }}>
                    {uiText("Caricamento spazi…")}
                  </Text>
                ) : roomFilter.trim() && !visibleRooms.length ? (
                  <Text style={{ color: c.muted }}>
                    {uiText("Nessuno spazio trovato.")}
                  </Text>
                ) : null}
              </ScrollView>
            </Panel>
          )}
        </>
      )}
      <Field
        label={uiText("Titolo")}
        value={label}
        onChangeText={setLabel}
        maxLength={editor.kind === "event" ? 200 : 1000}
      />
      <DateField label={uiText("Quando")} value={start} change={setStart} />
      {editor.kind === "event" ? (
        <>
          <DateField label={uiText("Fine")} value={end} change={setEnd} />
          {target !== editor.target && (
            <>
              {(["calendar", "all", "people"] as const).map((a, n) => (
                <Action
                  key={a}
                  label={
                    [
                      "Solo nel calendario",
                      "Tutto lo spazio",
                      "Scegli persone",
                    ][n]
                  }
                  primary={a === audience}
                  onPress={() => setAudience(a)}
                />
              ))}
              {audience === "people" &&
                directory.value?.members.map((m) => (
                  <Action
                    label={m.name}
                    key={m.id}
                    primary={people.includes(m.id)}
                    onPress={() =>
                      setPeople((list) =>
                        list.includes(m.id)
                          ? list.filter((v) => v !== m.id)
                          : [...list, m.id],
                      )
                    }
                  />
                ))}
            </>
          )}
        </>
      ) : i?.recurring ? (
        <Action
          label={
            following
              ? uiText("Da questa scadenza in poi")
              : uiText("Solo questa scadenza")
          }
          onPress={() => setFollowing(!following)}
        />
      ) : (
        !i && (
          <>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {(["once", "daily", "weekly"] as const).map((r, n) => (
                <Action
                  label={["Una volta", "Ogni giorno", "Scegli i giorni"][n]}
                  primary={r === rule}
                  key={r}
                  onPress={() => setRule(r)}
                />
              ))}
            </View>
            {rule === "weekly" && (
              <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
                {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map(
                  (l, n) => (
                    <Action
                      label={l}
                      primary={days.includes(n + 1)}
                      key={l}
                      onPress={() =>
                        setDays((pre) =>
                          pre.includes(n + 1)
                            ? pre.filter((v) => v !== n + 1)
                            : [...pre, n + 1].sort(),
                        )
                      }
                    />
                  ),
                )}
              </View>
            )}
          </>
        )
      )}
      <Text style={{ color: c.muted }}>{zone}</Text>
      <PendingStrip commands={ctl} />
      {!!(error || directory.error || rooms.error) && (
        <Text accessibilityRole="alert" style={{ color: c.text }}>
          {error || directory.error || rooms.error}
        </Text>
      )}
      <Action
        label={uiText("Salva")}
        primary
        disabled={
          !label.trim() ||
          !directory.value ||
          !ctl.ready ||
          ctl.working ||
          !!ctl.pending
        }
        onPress={save}
      />
    </ScrollView>
  );
}
