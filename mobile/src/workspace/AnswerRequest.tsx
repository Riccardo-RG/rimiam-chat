import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Text, View } from "react-native";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import { Action, usePalette } from "../ui";
import type { Commands } from "./useCommands";

export function AnswerRequest({
  messageId,
  actorId,
  snapshot,
  commands,
  canWrite,
  onDone,
}: {
  messageId: string;
  actorId: string;
  snapshot: Snapshot;
  commands: Commands;
  canWrite: boolean;
  onDone: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const [choose, setChoose] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const active = snapshot.members.filter(
    (m) => m.active && m.user_id !== actorId,
  );
  const recipients = selected.filter((id) =>
    active.some((m) => m.user_id === id),
  );
  const busy = commands.working || !!commands.pending || !commands.ready;
  return (
    <View style={{ gap: 5 }}>
      {snapshot.reading?.requestIds.includes(messageId) && (
        <Action
          label={uiText("Già risposto")}
          disabled={busy}
          onPress={async () => {
            if (
              await commands.send({
                kind: "command",
                label: "Segna la tua risposta",
                command: { type: "conversation.answered", messageId },
              })
            )
              onDone();
          }}
        />
      )}
      {canWrite && active.length > 0 && (
        <Action
          label={
            choose
              ? uiText("Annulla richiesta")
              : uiText("Richiedi una risposta")
          }
          onPress={() => setChoose(!choose)}
        />
      )}
      {canWrite && choose && (
        <>
          <Text style={{ color: p.muted }}>
            {uiText("Da chi aspetti una risposta?")}
          </Text>
          {active.map((m) => (
            <Action
              key={m.user_id}
              label={(recipients.includes(m.user_id) ? "✓ " : "") + m.name}
              primary={recipients.includes(m.user_id)}
              onPress={() =>
                setSelected((s) =>
                  s.includes(m.user_id)
                    ? s.filter((id) => id !== m.user_id)
                    : s.length < 40
                      ? [...s, m.user_id]
                      : s,
                )
              }
            />
          ))}
          <Action
            primary
            label={uiText("Richiedi risposta")}
            disabled={busy || !recipients.length}
            onPress={async () => {
              if (
                await commands.send({
                  kind: "command",
                  label: "Richiedi risposta",
                  command: {
                    type: "conversation.requestAnswer",
                    messageId,
                    recipients,
                  },
                })
              )
                onDone();
            }}
          />
        </>
      )}
    </View>
  );
}
