import { useUiLanguage } from "../i18n";
import React from "react";
import { View, Text, ScrollView, useWindowDimensions } from "react-native";
import { Action, usePalette } from "../ui";
import type { Commands } from "./useCommands";

export function PendingStrip({ commands: c }: { commands: Commands }) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const { height } = useWindowDimensions();
  if (!c.notice && !c.pending) return null;
  return (
    <ScrollView
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: p.panel,
        maxHeight: Math.min(192, height * 0.22),
        flexGrow: 0,
      }}
      contentContainerStyle={{ gap: 4, padding: 8 }}
    >
      {!!c.notice && <Text style={{ color: p.text }}>{c.notice}</Text>}
      {c.pending && (
        <>
          <Text style={{ color: p.text }}>
            {c.working ? uiText("In corso") : uiText("Conferma in attesa")} ·{" "}
            {c.pending.intent.label}
          </Text>
          {!c.working && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              <Action
                variant="quiet"
                label={uiText("Verifica esito")}
                onPress={() => void c.retry(false)}
              />
              <Action
                label={uiText("Riprova")}
                onPress={() => void c.retry(true)}
              />
              <Action
                variant="quiet"
                label={uiText("Rimuovi invio")}
                onPress={c.discard}
              />
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
