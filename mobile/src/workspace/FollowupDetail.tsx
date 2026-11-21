import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import type { FollowupItem } from "../../../src/contracts/tasks";
import { Action, Field, usePalette } from "../ui";
import { DateField } from "../DateField";
import {
  changeOccurrence,
  nextOccurrence,
  type ScheduleSubmit,
} from "./schedule-actions";

import { SeriesEditor } from "./SeriesEditor";
export function FollowupDetail({
  f,
  send,
  disabled,
  actor,
}: {
  f: FollowupItem;
  send: ScheduleSubmit;
  disabled: boolean;
  actor: string;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    at = nextOccurrence(f),
    isOwner = f.owner === actor;
  const [editing, edit] = useState(false),
    [following, setFollowing] = useState(false),
    [content, setContent] = useState(f.content);
  const [series, setSeries] = useState(false);
  const [when, setWhen] = useState(() => new Date(at ?? f.remindAt));
  const recurring = !!f.recurrence,
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const cmd = changeOccurrence(f, actor, following, content, when, tz);
  function close(all: boolean) {
    const label = all
      ? recurring
        ? "Termina la serie"
        : "Chiudi promemoria"
      : "Chiudi questa scadenza";
    Alert.alert(
      label + "?",
      all
        ? recurring
          ? uiText("Tutte le scadenze future verranno interrotte.")
          : uiText("Il promemoria verrà chiuso per il gruppo.")
        : uiText("Le altre scadenze restano programmate."),
      [
        { text: uiText("Annulla"), style: "cancel" },
        {
          text: uiText("Conferma"),
          onPress: () => {
            if (all)
              void send(label, {
                type: "followup.close",
                followupId: f.id,
                expectedVersion: f.version,
                reason: "Chiusura da parte del creatore",
                status: "done",
              });
            else if (at)
              void send(label, {
                type: "followup.occurrence",
                followupId: f.id,
                expectedVersion: f.version,
                scheduledAt: at,
                action: "close",
              });
          },
        },
      ],
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted }}>
        {f.status === "active"
          ? uiText("Attivo")
          : f.status === "done"
            ? uiText("Chiuso")
            : uiText("Annullato")}
        {f.needsReview ? uiText(" · Riferimento da verificare") : ""}
        {f.recurrence
          ? " · " +
            f.recurrence.weekdays
              .map(
                (i) => ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"][i - 1],
              )
              .join(", ")
          : ""}
        {f.recurrence?.until
          ? uiText(" · fino al {0}", String(f.recurrence.until))
          : ""}
      </Text>
      {isOwner && f.status === "active" && (
        <>
          {at && (
            <Action
              label={
                editing
                  ? uiText("Annulla modifica")
                  : uiText("Modifica scadenza")
              }
              disabled={disabled}
              onPress={() => {
                setSeries(false);
                edit(!editing);
              }}
            />
          )}
          {editing && (
            <>
              <Field
                label={uiText("Promemoria")}
                value={content}
                onChangeText={setContent}
                maxLength={2000}
                multiline
              />
              <DateField
                label={uiText("Quando")}
                value={when}
                change={setWhen}
              />
              {recurring && (
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}
                >
                  <Action
                    label={uiText("Solo questa scadenza")}
                    primary={!following}
                    onPress={() => setFollowing(false)}
                  />
                  <Action
                    label={uiText("Da questa in poi")}
                    primary={following}
                    onPress={() => setFollowing(true)}
                  />
                </View>
              )}
              {!cmd && (
                <Text style={{ color: c.muted }}>
                  {uiText(
                    "Scegli un orario futuro e inserisci il testo del promemoria.",
                  )}
                </Text>
              )}
              <Action
                label={uiText("Salva scadenza")}
                primary
                disabled={disabled || !cmd}
                onPress={async () => {
                  if (cmd && (await send("Modifica promemoria", cmd)))
                    edit(false);
                }}
              />
            </>
          )}
          {!editing && (
            <Action
              label={
                series
                  ? uiText("Chiudi programmazione")
                  : uiText("Modifica programmazione completa")
              }
              disabled={disabled}
              onPress={() => setSeries(!series)}
            />
          )}
          {series && (
            <SeriesEditor
              item={f}
              disabled={disabled}
              send={send}
              onClose={() => setSeries(false)}
            />
          )}
          {recurring && !!at && (
            <Action
              label={uiText("Chiudi questa scadenza")}
              disabled={disabled}
              onPress={() => close(false)}
            />
          )}
          <Action
            label={
              recurring
                ? uiText("Termina la serie")
                : uiText("Chiudi promemoria")
            }
            disabled={disabled}
            onPress={() => close(true)}
          />
        </>
      )}
    </View>
  );
}
