import { useUiLanguage } from "./i18n";
import React, { useState } from "react";
import { Platform, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Action } from "./ui";
export function DateField({
  label,
  value,
  change,
  dateOnly = false,
  timeOnly = false,
  emptyDateLabel,
}: {
  label: string;
  value: Date;
  change: (v: Date) => void;
  dateOnly?: boolean;
  timeOnly?: boolean;
  emptyDateLabel?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const [which, setWhich] = useState<"date" | "time" | null>(null);
  return (
    <View style={{ gap: 5, flexDirection: "row", flexWrap: "wrap" }}>
      {!timeOnly && (
        <Action
          label={
            label + " · " + (emptyDateLabel || value.toLocaleDateString(locale))
          }
          onPress={() => setWhich("date")}
        />
      )}
      {!dateOnly && (
        <Action
          label={
            (timeOnly ? label + " · " : "") +
            value.toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
            })
          }
          onPress={() => setWhich("time")}
        />
      )}
      {which && (
        <DateTimePicker
          mode={which}
          locale={Platform.OS === "ios" ? locale : undefined}
          value={value}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(event, d) => {
            if (Platform.OS !== "ios" || event.type === "dismissed")
              setWhich(null);
            if (event.type === "set" && d) change(d);
          }}
        />
      )}
      {which && Platform.OS === "ios" && (
        <Action label={uiText("Fine")} onPress={() => setWhich(null)} />
      )}
    </View>
  );
}
