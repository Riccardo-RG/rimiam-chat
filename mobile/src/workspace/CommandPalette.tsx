import { useUiLanguage } from "../i18n";
import React, { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  availableComposerActions,
  type ComposerActionId,
  type ComposerActionPermissions,
} from "../../../src/shared/composer-actions";
import { Action, usePalette } from "../ui";
import { StudioIcon } from "../StudioIcon";
import { ConversationDialog } from "./ConversationDialog";

export function CommandPalette({
  assistantName,
  permissions,
  initial,
  choose,
  onClose,
  write,
}: {
  permissions: ComposerActionPermissions;
  assistantName: string;
  initial: string | null;
  choose: (id: ComposerActionId) => void;
  onClose: () => void;
  write: (text: string) => void;
}) {
  const { locale, t: uiText } = useUiLanguage();
  const p = usePalette(),
    [query, setQuery] = useState(initial ?? "");
  const input = useRef<TextInput>(null);
  const entries = availableComposerActions(permissions, query, locale);
  return (
    <ConversationDialog
      title={uiText("Azioni dello spazio")}
      onClose={onClose}
      onShow={() => input.current?.focus()}
    >
      <TextInput
        ref={input}
        accessibilityLabel={uiText("Cerca un’azione")}
        placeholderTextColor={p.muted}
        style={{
          color: p.text,
          fontSize: 16,
          borderWidth: 1,
          borderRadius: 6,
          borderColor: p.controlLine,
          paddingHorizontal: 10,
          minHeight: 44,
        }}
        placeholder={uiText("Cerca per nome o comando")}
        value={query}
        onChangeText={(value) => {
          if (
            initial !== null &&
            (value.includes("/") || /^feedback\s/i.test(value))
          )
            write("/" + value);
          else setQuery(value);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => {
          if (entries[0]) choose(entries[0].id);
        }}
      />
      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {entries.map((a, i) => (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            accessibilityLabel={
              a.label.replace(/Emme/g, () => assistantName) +
              " · " +
              a.shortcuts.join(" · ")
            }
            onPress={() => choose(a.id)}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderRadius: 8,
              backgroundColor: pressed || i === 0 ? p.panel : "transparent",
              paddingHorizontal: 8,
              paddingVertical: 7,
            })}
          >
            <StudioIcon name={a.icon} color={p.muted} size={18} />
            <Text style={{ flex: 1, fontSize: 15, color: p.text }}>
              {a.label.replace(/Emme/g, () => assistantName)}
            </Text>
            <Text
              style={{
                color: p.muted,
                fontSize: 12,
                maxWidth: "39%",
                textAlign: "right",
              }}
            >
              {a.shortcuts.join(" · ")}
            </Text>
          </Pressable>
        ))}
        {!entries.length && (
          <Text style={{ color: p.muted, padding: 8 }}>
            {uiText("Nessuna azione trovata.")}
          </Text>
        )}
      </ScrollView>
      {initial !== null && (
        <View>
          <Action
            variant="quiet"
            label={uiText("Usa come testo del messaggio")}
            onPress={() => write("/" + query)}
          />
        </View>
      )}
    </ConversationDialog>
  );
}
