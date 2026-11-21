import { useUiLanguage } from "../i18n";
import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type {
  TaskOffer,
  ReminderLineData,
} from "../../../src/contracts/agenda";
import type { NativeRequest } from "../api";
import { Action, Field, usePalette } from "../ui";
import { useCommands, type Commands } from "./useCommands";
import { DateField } from "../DateField";
import { PendingStrip } from "./PendingStrip";
export function TaskOfferRow({
  offer,
  actor,
  commands,
  open,
}: {
  offer: TaskOffer;
  actor: string;
  commands: Commands;
  open: () => void;
}) {
  const { locale, t: uiText } = useUiLanguage();
  const p = usePalette(),
    [show, setShow] = useState(false);
  const label =
    offer.status === "accepted"
      ? offer.acceptedBy
        ? uiText("{0} ha accettato", offer.acceptedBy)
        : uiText("Incarico accettato")
      : offer.status === "declined"
        ? uiText("{0} ha rifiutato", offer.personName)
        : offer.status === "outdated"
          ? uiText("Proposta superata")
          : uiText("Proposta per {0}", offer.personName);
  const busy = commands.working || !!commands.pending || !commands.ready;
  const base = { taskId: offer.taskId, expectedVersion: offer.version };
  return (
    <View style={{ gap: 4 }}>
      <Action
        variant="quiet"
        icon="work"
        label={offer.title + " · " + label}
        onPress={() => setShow(!show)}
      />
      {show && (
        <>
          {!!offer.description && (
            <Text style={{ color: p.text }}>{offer.description}</Text>
          )}
          {offer.due && (
            <Text style={{ color: p.muted }}>
              {uiText("Scadenza · ")}
              {new Date(offer.due).toLocaleString(locale)}
            </Text>
          )}
          {offer.status === "pending" && offer.person === actor && (
            <>
              <Action
                label={uiText("Accetta")}
                disabled={busy}
                onPress={() =>
                  void commands.send({
                    kind: "command",
                    label: "Accetta attività",
                    command: {
                      type: "task.accept",
                      ...base,
                      reason: "Accettazione personale dalla conversazione",
                      representSelf: true,
                    },
                  })
                }
              />
              <Action
                label={uiText("Rifiuta")}
                disabled={busy}
                onPress={() =>
                  void commands.send({
                    kind: "command",
                    label: "Rifiuta attività",
                    command: {
                      type: "task.decline",
                      ...base,
                      reason: "Proposta rifiutata dalla conversazione",
                    },
                  })
                }
              />
            </>
          )}
          <Action label={uiText("In programma")} onPress={open} />
        </>
      )}
    </View>
  );
}
type Props = {
  r: ReminderLineData;
  messageId: string;
  commands: Commands;
  workspaceId: string;
  origin: string;
  actor: string;
  request: NativeRequest;
  refresh: () => void;
};
export function ReminderRow(props: Props) {
  const { locale, t: uiText } = useUiLanguage();
  const { r } = props;
  const [edit, setEdit] = useState(false);
  const p = usePalette();
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: p.text }}>
        {uiText("Promemoria · ")}
        {r.audience === "space" ? uiText("Per tutti") : uiText("Solo io")}
        {r.at ? " · " + new Date(r.at).toLocaleString(locale) : ""}
        {r.closed ? uiText(" · Chiuso") : ""}
      </Text>
      {!r.closed && (
        <Action
          label={
            edit
              ? uiText("Chiudi")
              : r.id
                ? uiText("Modifica promemoria")
                : r.day
                  ? uiText("Imposta orario")
                  : uiText("Imposta data e ora")
          }
          onPress={() => setEdit(!edit)}
        />
      )}
      {edit &&
        (r.id && r.destination && r.destination !== props.workspaceId ? (
          <PrivateReminder
            {...props}
            destination={r.destination}
            done={() => setEdit(false)}
          />
        ) : (
          <ReminderForm {...props} done={() => setEdit(false)} />
        ))}
    </View>
  );
}
function PrivateReminder(
  props: Props & { destination: string; done: () => void },
) {
  const scope = useMemo(
    () => ({
      origin: props.origin,
      actorId: props.actor,
      workspaceId: props.destination,
    }),
    [props.origin, props.actor, props.destination],
  );
  const commands = useCommands(props.request, scope, () => {
    props.refresh();
    props.done();
  });
  return (
    <>
      <PendingStrip commands={commands} />
      <ReminderForm {...props} commands={commands} />
    </>
  );
}
function ReminderForm({
  r,
  messageId,
  commands,
  done,
}: {
  r: ReminderLineData;
  messageId: string;
  commands: Commands;
  done: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const [title, setTitle] = useState(r.content),
    [date, setDate] = useState(() =>
      r.at
        ? new Date(r.at)
        : r.day
          ? new Date(r.day + "T12:00")
          : new Date(Date.now() + 3600000),
    ),
    [following, setFollowing] = useState(false),
    [error, setError] = useState("");
  const busy = commands.working || !!commands.pending || !commands.ready;
  async function save() {
    if (!Number.isFinite(+date)) {
      setError(uiText("Scegli data e ora valide."));
      return;
    }
    if (r.id && (!r.destination || !r.version || !r.at)) {
      setError(uiText("Il promemoria è cambiato. Riapri la conferma."));
      return;
    }
    const command =
      r.id && r.version && r.at
        ? {
            type: "followup.occurrence" as const,
            action: following
              ? ("replace_following" as const)
              : ("replace" as const),
            followupId: r.id,
            expectedVersion: r.version,
            scheduledAt: r.at,
            replacement: {
              content: title.trim(),
              remindAt: date.toISOString(),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
          }
        : {
            type: "reminder.set_time" as const,
            messageId,
            remindAt: date.toISOString(),
          };
    if (
      await commands.send({
        kind: "command",
        label: "Aggiorna promemoria",
        command,
      })
    )
      done();
  }
  return (
    <View style={{ gap: 5 }}>
      {!!r.id && (
        <Field
          label={uiText("Cosa ricordare")}
          value={title}
          maxLength={2000}
          onChangeText={setTitle}
        />
      )}
      <DateField
        label={
          r.day && !r.id
            ? uiText("Ora del {0}", String(r.day))
            : uiText("Quando")
        }
        value={date}
        change={setDate}
        timeOnly={!!r.day && !r.id}
      />
      {r.recurring && r.id && (
        <Action
          label={
            following
              ? uiText("Da questa scadenza in poi")
              : uiText("Solo questa scadenza")
          }
          onPress={() => setFollowing(!following)}
        />
      )}
      {!!error && <Text style={{ color: p.text }}>{error}</Text>}
      <Action
        primary
        label={uiText("Conferma")}
        disabled={busy || (!!r.id && !title.trim())}
        onPress={() => void save()}
      />
    </View>
  );
}
