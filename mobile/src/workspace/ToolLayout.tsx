import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StudioIcon } from "../StudioIcon";
import { usePalette } from "../ui";

type Icon = React.ComponentProps<typeof StudioIcon>["name"];

export function ToolHeader({
  title,
  onBack,
  onClose,
  headerActions,
  contextName,
  backLabel,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
  headerActions?: React.ReactNode;
  backLabel?: string;
  contextName?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const [width, setWidth] = useState(0);
  const secondRow = !!headerActions && width > 0 && width < 480;
  return (
    <View
      onLayout={
        headerActions
          ? (event) => setWidth(event.nativeEvent.layout.width)
          : undefined
      }
      style={{
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderColor: c.line,
        backgroundColor: c.panel,
      }}
    >
      <View
        style={{
          minHeight: 54,
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
        }}
      >
        {!!onBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backLabel ?? uiText("Indice dello spazio")}
            onPress={onBack}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
              transform: [{ rotate: "180deg" }],
            })}
          >
            <StudioIcon name="chevron" color={c.muted} size={18} />
          </Pressable>
        )}
        <View style={{ flex: 1, minWidth: 0, paddingVertical: 6 }}>
          {!!contextName && (
            <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
              {contextName}
            </Text>
          )}
          <Text
            accessibilityRole="header"
            style={{ color: c.text, fontSize: 17, fontWeight: "600" }}
          >
            {title}
          </Text>
        </View>
        {!secondRow && headerActions}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uiText("Chiudi")}
          onPress={onClose}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 8,
            gap: 5,
            flexDirection: "row",
            alignItems: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: c.text, fontWeight: "600" }}>
            {uiText("Chiudi")}
          </Text>
          <StudioIcon name="close" color={c.muted} size={15} />
        </Pressable>
      </View>
      {secondRow && (
        <View style={{ alignSelf: "flex-end" }}>{headerActions}</View>
      )}
    </View>
  );
}
export function ToolRow({
  label,
  icon,
  onPress,
  expanded,
  disabled = false,
}: {
  label: string;
  icon?: Icon;
  onPress: () => void;
  expanded?: boolean;
  disabled?: boolean;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        gap: 10,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 4,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderColor: c.line,
        backgroundColor: pressed ? c.panel : "transparent",
        opacity: disabled ? 0.52 : 1,
      })}
    >
      {icon && <StudioIcon name={icon} color={c.muted} size={19} />}
      <Text style={{ color: c.text, flex: 1, fontSize: 16 }}>{label}</Text>
      <View style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}>
        <StudioIcon name="chevron" color={c.muted} size={15} />
      </View>
    </Pressable>
  );
}
export function ChoiceStrip({
  choices,
  value,
  onSelect,
  label,
}: {
  choices: readonly string[];
  value: string;
  onSelect: (s: string) => void;
  label: string;
}) {
  const { t } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  return (
    <View
      accessibilityLabel={uiText(label)}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}
    >
      {choices.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityState={{ selected: option === value }}
          onPress={() => onSelect(option)}
          style={({ pressed }) => ({
            borderRadius: 8,
            minHeight: 48,
            justifyContent: "center",
            paddingHorizontal: 10,
            backgroundColor:
              option === value || pressed ? p.panel : "transparent",
          })}
        >
          <Text
            style={{
              fontWeight: option === value ? "700" : "500",
              color: option === value ? p.text : p.muted,
              fontSize: 14,
            }}
          >
            {t(option)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
