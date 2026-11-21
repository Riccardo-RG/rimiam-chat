import React from "react";
import { Text, View } from "react-native";
import {
  assistantFailureText,
  type AssistantRequestFailure,
} from "../../../src/shared/assistant-request-failures";
import { useUiLanguage } from "../i18n";
import { Action, usePalette } from "../ui";
import type { Commands } from "./useCommands";

export function AssistantFailureNotice({
  failure,
  canRetry,
  commands,
}: {
  failure: AssistantRequestFailure;
  canRetry: boolean;
  commands: Commands;
}) {
  const { t } = useUiLanguage();
  const p = usePalette();
  return (
    <View style={{ gap: 4, alignItems: "flex-start" }}>
      <Text accessibilityLiveRegion="polite" style={{ color: p.muted }}>
        {assistantFailureText(failure.reason, failure.displayName, t)}
      </Text>
      {canRetry && failure.retryable && (
        <Action
          variant="quiet"
          label={t("Riprova questa richiesta")}
          disabled={!commands.ready || commands.working || !!commands.pending}
          onPress={() =>
            void commands.send({
              kind: "command",
              label: t("Riprova questa richiesta"),
              command: {
                type: "interpretation.retry",
                interpretationId: failure.interpretationId,
              },
            })
          }
        />
      )}
    </View>
  );
}
