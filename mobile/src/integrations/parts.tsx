import type { ReactNode } from "react";
import { Alert, Text, View } from "react-native";
import { usePalette } from "../ui";

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        gap: 10,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderColor: p.line,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 19, fontWeight: "600", color: p.text }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Body({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <Text selectable style={{ fontSize: 16, lineHeight: 23, color: p.text }}>
      {children}
    </Text>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <Text style={{ fontSize: 15, lineHeight: 21, color: p.muted }}>
      {children}
    </Text>
  );
}

export function confirm(
  uiText: (source: string) => string,
  title: string,
  description: string,
  actionLabel: string,
  onConfirm: () => void,
) {
  Alert.alert(
    title,
    description,
    [
      { text: uiText("Annulla"), style: "cancel" },
      { text: actionLabel, onPress: onConfirm },
    ],
    { cancelable: true },
  );
}
