import React, { useState } from "react";
import {
  Pressable,
  Platform,
  Text,
  TextInput,
  useWindowDimensions,
  type TextInputProps,
} from "react-native";
import { useAppearance } from "./appearance";
import { StudioIcon, type StudioIconName } from "./StudioIcon";

// Studio surfaces and accent pairs follow src/app/ritmo.css.
const light = {
  bg: "#fdfdfc",
  surface: "#ffffff",
  field: "#ffffff",
  rail: "#f3f3f0",
  panel: "#f1f2ee",
  text: "#20211e",
  muted: "#646660",
  line: "#dedfd9",
  controlLine: "#85887f",
  accent: "#282b27",
  heading: "#38424a",
  accentSoft: "#dce1e3",
  selected: "#e4e5df",
  emme: "#43545b",
  onAccent: "#ffffff",
  danger: "#a12c46",
  focus: "#575f68",
};
const dark = {
  bg: "#222321",
  surface: "#282926",
  field: "#2b2c29",
  rail: "#1a1b19",
  panel: "#2e302c",
  text: "#efefeb",
  muted: "#a5a79f",
  line: "#41423e",
  controlLine: "#808379",
  accent: "#eeeee8",
  heading: "#cfd5d8",
  accentSoft: "#343a3e",
  selected: "#33352f",
  emme: "#c6d3d8",
  onAccent: "#20211e",
  danger: "#ffb4c0",
  focus: "#c6ccc7",
};
export function usePalette() {
  const pref = useAppearance();
  const base = pref.dark ? dark : light;
  const pairs = {
    ocean: pref.dark ? "#a6c7ee" : "#255486",
    forest: pref.dark ? "#a0ceba" : "#285e4b",
    plum: pref.dark ? "#d8b8df" : "#694870",
  };
  if (pref.settings.accent === "neutral") return base;
  const accent = pairs[pref.settings.accent];
  return {
    ...base,
    accent,
    heading: base.text,
    accentSoft: base.selected,
    focus: accent,
  };
}

export const touchSize = Platform.OS === "android" ? 48 : 44;

export function Action({
  label,
  onPress,
  primary = false,
  disabled = false,
  variant = "secondary",
  icon,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  variant?: "secondary" | "quiet" | "outline" | "selected";
  icon?: StudioIconName;
}) {
  const c = usePalette();
  const ink = primary
    ? c.onAccent
    : variant === "selected"
      ? c.heading
      : variant === "quiet"
        ? c.muted
        : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{
        disabled,
        selected: variant === "selected" ? true : undefined,
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touchSize,
        minWidth: touchSize,
        maxWidth: "100%",
        paddingHorizontal: variant === "quiet" ? 10 : 14,
        paddingVertical: 9,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "row",
        gap: 7,
        borderRadius: 10,
        borderWidth: variant === "outline" ? 1 : 0,
        borderColor: c.line,
        backgroundColor: primary
          ? c.accent
          : variant === "quiet" || variant === "outline"
            ? "transparent"
            : variant === "selected"
              ? c.accentSoft
              : c.panel,
        opacity: disabled ? 0.5 : pressed ? 0.76 : 1,
      })}
    >
      {icon && <StudioIcon name={icon} color={ink} size={18} />}
      <Text
        style={{ fontSize: 15.5, fontWeight: "600", color: ink, flexShrink: 1 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  style,
  onFocus,
  onBlur,
  ...input
}: TextInputProps & { label: string }) {
  const c = usePalette();
  const [focused, setFocused] = useState(false);
  const { width } = useWindowDimensions();
  const size = Math.min(18, Math.max(17, 16.48 + 0.0016 * width));
  return (
    <>
      <Text style={{ color: c.text, fontWeight: "600", fontSize: 15 }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            borderColor: focused ? c.focus : c.controlLine,
            borderWidth: 1,
            borderRadius: 10,
            color: c.text,
            backgroundColor: c.field,
            minHeight: 46,
            fontSize: size,
            paddingHorizontal: 12,
            paddingVertical: 8,
          },
          style,
        ]}
      />
    </>
  );
}
