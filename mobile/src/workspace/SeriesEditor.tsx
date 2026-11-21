import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Text, View } from "react-native";
import type { FollowupItem } from "../../../src/contracts/tasks";
import { Action, Field, usePalette } from "../ui";
import { DateField } from "../DateField";
import type { ScheduleSubmit } from "./schedule-actions";

export function SeriesEditor({
  item,
  disabled,
  send,
  onClose,
}: {
  item: FollowupItem;
  disabled: boolean;
  send: ScheduleSubmit;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const [content, write] = useState(item.content),
    [date, setDate] = useState(() => new Date(item.remindAt)),
    [days, setDays] = useState<number[]>(item.recurrence?.weekdays ?? []);
  const [keepSource, setKeepSource] = useState(!!item.reference);
  const [until, setUntil] = useState(item.recurrence?.until ?? "");
  const validUntil =
    !until ||
    (/^\d{4}-\d\d-\d\d$/.test(until) &&
      Number.isFinite(Date.parse(until)) &&
      new Date(until).toISOString().slice(0, 10) === until);
  const zone = item.timeZone;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted }}>
        {uiText(
          "Vale per la programmazione completa. Orari della serie nel fuso ",
        )}
        {zone}.
      </Text>
      <Field
        label={uiText("Testo del promemoria")}
        value={content}
        onChangeText={write}
        maxLength={2000}
        multiline
      />
      <DateField
        label={uiText("Prima scadenza")}
        value={date}
        change={setDate}
      />
      <Text style={{ color: c.text }}>
        {uiText("Ripetizione ·")}{" "}
        {days.length === 0
          ? uiText("una volta")
          : days.length === 7
            ? uiText("ogni giorno")
            : uiText("settimanale")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
        {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((s, i) => (
          <Action
            key={s}
            label={s}
            primary={days.includes(i + 1)}
            onPress={() =>
              setDays((list) =>
                list.includes(i + 1)
                  ? list.filter((day) => day !== i + 1)
                  : [...list, i + 1].sort(),
              )
            }
          />
        ))}
      </View>
      {!!days.length && (
        <Field
          label={uiText("Ripeti fino al (facoltativo)")}
          placeholder={uiText("AAAA-MM-GG")}
          value={until}
          onChangeText={setUntil}
          maxLength={10}
        />
      )}
      {!!item.reference && (
        <Action
          label={
            keepSource
              ? uiText("Scollega il riferimento originale")
              : uiText("Mantieni il riferimento originale")
          }
          onPress={() => setKeepSource(!keepSource)}
        />
      )}
      {!validUntil && !!days.length && (
        <Text style={{ color: c.muted }}>
          {uiText("Inserisci una data valida.")}
        </Text>
      )}
      <Action
        label={uiText("Salva programmazione")}
        disabled={
          disabled ||
          !content.trim() ||
          (!!days.length && !validUntil) ||
          (!days.length && +date <= Date.now())
        }
        onPress={async () => {
          if (
            await send("Aggiorna programmazione", {
              type: "followup.revise",
              followupId: item.id,
              expectedVersion: item.version,
              reason: "Revisione esplicita della programmazione",
              kind: item.kind,
              content: content.trim(),
              remindAt: date.toISOString(),
              timeZone: zone,
              reference: keepSource ? item.reference : null,
              recurrence: days.length
                ? { weekdays: days, ...(until ? { until } : {}) }
                : null,
            })
          )
            onClose();
        }}
      />
      <Action label={uiText("Annulla programmazione")} onPress={onClose} />
    </View>
  );
}
