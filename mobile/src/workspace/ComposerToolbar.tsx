import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { StudioIcon, type StudioIconName } from "../StudioIcon";
import { usePalette } from "../ui";

type Props = {
  disabled: boolean;
  canSend: boolean;
  ask: boolean;
  assistant: string;
  feedback: boolean;
  attach: () => void;
  camera: () => void;
  voice: () => void;
  call: () => void;
  actions: () => void;
  send: () => void;
  askAssistant: () => void;
  dismissKeyboard?: () => void;
};
export function ComposerToolbar(props: Props) {
  const { t } = useUiLanguage();
  const { disabled, canSend, ask, assistant, feedback } = props,
    p = usePalette();
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const [measured, setMeasured] = useState(0);
  const width = measured || screenWidth;
  const tight = width < 375 || fontScale > 1.45,
    wide = width >= 720;
  function control(
    name: StudioIconName | "slash",
    label: string,
    action: () => void,
    options: {
      selected?: boolean;
      disabled?: boolean;
      caption?: string;
      send?: boolean;
    } = {},
  ) {
    const inactive = !!options.disabled;
    const ink = options.send
      ? p.onAccent
      : options.selected
        ? p.accent
        : p.muted;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive, selected: options.selected }}
        disabled={inactive}
        onPress={action}
        style={({ pressed }) => ({
          minWidth: 44,
          minHeight: 44,
          paddingHorizontal: options.caption ? 7 : 0,
          borderRadius: options.send ? 23 : 9,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 4,
          opacity: inactive ? 0.48 : pressed ? 0.75 : 1,
          backgroundColor: options.send
            ? p.accent
            : options.selected || pressed
              ? p.panel
              : "transparent",
        })}
      >
        {name === "slash" ? (
          <Text
            style={{
              fontSize: 18,
              fontWeight: "600",
              lineHeight: 22,
              color: ink,
            }}
          >
            /
          </Text>
        ) : (
          <StudioIcon name={name} color={ink} size={21} />
        )}
        {!!options.caption && (
          <Text
            numberOfLines={1}
            style={{ color: ink, fontSize: 14, fontWeight: "600" }}
          >
            {options.caption}
          </Text>
        )}
      </Pressable>
    );
  }
  const askLabel = ask ? t("Scrivi al gruppo") : t("Chiedi a {0}", assistant);
  return (
    <View
      onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        paddingHorizontal: tight ? 0 : 2,
      }}
    >
      {control("attach", t("Allega"), props.attach, { disabled })}
      {control("camera", t("Scatta foto"), props.camera, { disabled })}
      {control("slash", t("/ Azioni"), props.actions, {
        disabled,
        caption: wide ? t("Azioni") : undefined,
      })}
      {control("microphone", t("Messaggio vocale"), props.voice, { disabled })}
      {control("phone", t("Chiamata audio"), props.call, { disabled })}
      <View style={{ flex: 1, minWidth: 0 }} />
      {control("mark", askLabel, props.askAssistant, {
        disabled: disabled || feedback,
        selected: ask,
        caption: wide ? askLabel : undefined,
      })}
      {control(
        "send",
        feedback
          ? t("Salva feedback")
          : ask
            ? t("A {0}", assistant)
            : t("Invia"),
        props.send,
        { disabled: disabled || !canSend, send: true },
      )}
      {props.dismissKeyboard &&
        control("close", t("Chiudi tastiera"), props.dismissKeyboard)}
    </View>
  );
}
