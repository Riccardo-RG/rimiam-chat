import { useUiLanguage } from "../i18n";
import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Action, usePalette } from "../ui";

/** Lightweight overlays preserve the conversation behind the controls, including at phone widths. */
export function ConversationDialog({
  title,
  children,
  onClose,
  onShow,
  visible = true,
  onDismiss,
  compact = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onShow?: () => void;
  visible?: boolean;
  onDismiss?: () => void;
  compact?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    safe = useSafeAreaInsets(),
    { width, height } = useWindowDimensions();
  const phone = width <= 640;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
      onShow={onShow}
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: phone ? "flex-start" : "center",
            paddingLeft: safe.left + 8,
            paddingRight: safe.right + 8,
            paddingTop: safe.top + 8,
            paddingBottom: safe.bottom + 8,
            backgroundColor: "rgba(10,18,34,0.36)",
          }}
        >
          <Pressable
            accessible={false}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            style={{
              width: "100%",
              maxWidth: 448,
              maxHeight: Math.min(height * 0.75, compact ? 360 : 440),
              flexShrink: 1,
              borderWidth: 1,
              borderColor: c.controlLine,
              borderRadius: 12,
              padding: 10,
              backgroundColor: c.surface,
              gap: 6,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Text
                style={{
                  flex: 1,
                  color: c.text,
                  fontSize: 19,
                  fontWeight: "600",
                }}
                accessibilityRole="header"
              >
                {title}
              </Text>
              <Action
                variant="quiet"
                label={uiText("Chiudi")}
                icon="close"
                onPress={onClose}
              />
            </View>
            {children}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
