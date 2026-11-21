import React from "react";
import { Text, View } from "react-native";
import { useUiLanguage } from "./i18n";
import { Action, usePalette } from "./ui";

export function LanguageChoice() {
  const { preference, setLocale, storageFailed, t } = useUiLanguage();
  const c = usePalette();
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: c.text, fontWeight: "600" }}>{t("Lingua")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(["system", "it", "en"] as const).map((option) => (
          <Action
            key={option}
            label={
              option === "system"
                ? t("Lingua del dispositivo")
                : option === "it"
                  ? "Italiano"
                  : "English"
            }
            variant={preference === option ? "selected" : "outline"}
            onPress={() => setLocale(option)}
          />
        ))}
      </View>
      {storageFailed && (
        <Text accessibilityRole="alert" style={{ color: c.text }}>
          {t(
            "La lingua scelta vale per questa sessione. Il salvataggio sul dispositivo non è riuscito.",
          )}
        </Text>
      )}
    </View>
  );
}
