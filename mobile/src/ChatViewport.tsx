import React, { useEffect, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Composer screens sit inside the app safe area. Keyboard coordinates on both platforms are screen-relative. */
export function ChatViewport({
  children,
  backgroundColor,
}: {
  children: ReactNode;
  backgroundColor: string;
}) {
  const { top } = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor }}
      enabled={Platform.OS !== "android" || keyboardOpen}
      keyboardVerticalOffset={top}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
