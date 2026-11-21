import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import type { ConversationHandoff } from "../../../src/contracts/conversation-handoff";
import type { Candidate, Snapshot } from "../../../src/contracts/web-snapshot";
import { Action, Field, usePalette } from "../ui";
import type { Commands } from "./useCommands";

type Base = Pick<
  Snapshot["information"][number],
  "id" | "current_version" | "content"
>;

export function CandidateActions({
  candidate,
  snapshot,
  actorId,
  commands,
  disabled,
  handoff,
}: {
  candidate: Candidate;
  snapshot: Snapshot;
  actorId: string;
  commands: Commands;
  disabled: boolean;
  handoff?: ConversationHandoff;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const [base, setBase] = useState<Base | null>(null);
  const [reason, setReason] = useState("");
  const [people, setPeople] = useState<string[] | null>(null);
  const addressed = handoff?.candidateId === candidate.id ? handoff : undefined;
  const correction =
    addressed?.kind === "information.correct" ? addressed : undefined;
  const current = snapshot.information.find((i) =>
    correction
      ? i.id === correction.target?.id
      : i.subject === candidate.subject,
  );
  const active = snapshot.members.filter((m) => m.active);
  const stale =
    candidate.context_revision !== snapshot.workspace.context_revision ||
    (correction &&
      (!current || current.current_version !== correction.target?.version)) ||
    (addressed && addressed.status !== "ready");

  if (stale)
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: p.muted }}>
          {uiText("Lo spazio è cambiato dopo questa proposta.")}
        </Text>
        <Action
          label={uiText("Richiedi una nuova lettura")}
          disabled={disabled}
          onPress={() =>
            void commands.send({
              kind: "command",
              label: "Rileggi la fonte",
              command: {
                type: "interpretation.retry",
                interpretationId: candidate.interpretation_id,
              },
            })
          }
        />
      </View>
    );
  if (base)
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: p.muted }}>
          {uiText("Versione ")}
          {base.current_version}
          {uiText(" da correggere")}
        </Text>
        <Text selectable style={{ color: p.text }}>
          {base.content}
        </Text>
        <Text style={{ color: p.muted }}>{uiText("Nuovo testo")}</Text>
        <Text selectable style={{ color: p.text }}>
          {candidate.content}
        </Text>
        <Field
          label={uiText("Motivo della correzione")}
          value={reason}
          onChangeText={setReason}
          maxLength={12000}
        />
        <Action
          label={uiText("Conferma correzione")}
          disabled={
            disabled ||
            !reason.trim() ||
            current?.current_version !== base.current_version
          }
          onPress={async () => {
            if (
              await commands.send({
                kind: "command",
                label: "Correggi il riferimento",
                command: {
                  type: "information.correct",
                  informationId: base.id,
                  expectedVersion: base.current_version,
                  candidateId: candidate.id,
                  reason: reason.trim(),
                  descriptiveOnly: true,
                  ...(correction && {
                    conversationOrigin: { handoffId: correction.id },
                  }),
                },
              })
            )
              setBase(null);
          }}
        />
        <Action label={uiText("Annulla")} onPress={() => setBase(null)} />
      </View>
    );
  if (people)
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: p.muted }}>
          {uiText("Chi riguarda l’impegno? Ciascuna persona approva per sé.")}
        </Text>
        {active.map((m) => (
          <View
            key={m.user_id}
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <Switch
              accessibilityLabel={m.name}
              value={people.includes(m.user_id)}
              disabled={
                disabled ||
                m.user_id === actorId ||
                (people.length >= 20 && !people.includes(m.user_id))
              }
              onValueChange={(on) =>
                setPeople((prev) =>
                  on
                    ? [...new Set([...(prev ?? []), m.user_id])]
                    : (prev ?? []).filter((id) => id !== m.user_id),
                )
              }
            />
            <Text style={{ color: p.text, flex: 1 }}>
              {m.name}
              {m.user_id === actorId ? uiText(" · tu") : ""}
            </Text>
          </View>
        ))}
        <Action
          label={uiText("Proponi impegno alle persone selezionate")}
          disabled={
            disabled ||
            people.some((id) => !active.some((m) => m.user_id === id))
          }
          onPress={async () => {
            if (
              await commands.send({
                kind: "command",
                label: "Proponi impegno",
                command: {
                  type: "commitment.propose",
                  candidateId: candidate.id,
                  people,
                },
              })
            )
              setPeople(null);
          }}
        />
        <Action label={uiText("Annulla")} onPress={() => setPeople(null)} />
      </View>
    );
  return (
    <View style={{ gap: 6 }}>
      {candidate.classification === "descriptive" &&
        (current ? (
          <Action
            label={uiText("Valuta come correzione")}
            disabled={disabled}
            onPress={() => {
              setReason("");
              setBase(current);
            }}
          />
        ) : (
          <Action
            label={uiText("Accetta come riferimento")}
            disabled={disabled}
            onPress={() =>
              Alert.alert(
                uiText("Accettare questo riferimento?"),
                candidate.content,
                [
                  { text: uiText("Annulla"), style: "cancel" },
                  {
                    text: uiText("Accetta"),
                    onPress: () =>
                      void commands.send({
                        kind: "command",
                        label: "Accetta riferimento",
                        command: {
                          type: "information.accept",
                          candidateId: candidate.id,
                          descriptiveOnly: true,
                          ...(addressed?.kind === "information.accept" && {
                            conversationOrigin: { handoffId: addressed.id },
                          }),
                        },
                      }),
                  },
                ],
              )
            }
          />
        ))}
      {candidate.classification === "question" && (
        <Action
          label={uiText("Conserva come domanda aperta")}
          disabled={disabled}
          onPress={() =>
            void commands.send({
              kind: "command",
              label: "Apri domanda",
              command: {
                type: "question.open",
                candidateId: candidate.id,
                sourceId: candidate.source_id,
                content: candidate.content,
              },
            })
          }
        />
      )}
      <Action
        label={uiText("Proponi come impegno")}
        disabled={disabled}
        onPress={() => setPeople([actorId])}
      />
    </View>
  );
}
