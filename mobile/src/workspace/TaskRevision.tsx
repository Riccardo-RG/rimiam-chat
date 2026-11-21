import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import type { TaskItem, TasksView } from "../../../src/contracts/tasks";
import { Action, Field, usePalette } from "../ui";
import { DateField } from "../DateField";
import {
  revisionCommand,
  adoptionCommand,
  type ScheduleSubmit,
} from "./schedule-actions";

type Props = {
  task: TaskItem;
  proposals: TasksView["proposals"];
  members: TasksView["members"];
  disabled: boolean;
  actorId: string;
  send: ScheduleSubmit;
};
export function TaskRevision({
  task,
  proposals,
  members,
  disabled,
  actorId,
  send,
}: Props) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const c = usePalette();
  const [editing, edit] = useState(false);
  const [title, setTitle] = useState(task.title),
    [description, setDescription] = useState(task.description),
    [due, setDue] = useState<Date | null>(
      task.dueAt ? new Date(task.dueAt) : null,
    ),
    [reason, setReason] = useState("");
  const [person, setPerson] = useState(task.suggestedPerson);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const content = {
    title: title.trim(),
    description: description.trim(),
    dueAt: due?.toISOString() ?? null,
    timeZone:
      due?.getTime() === (task.dueAt ? Date.parse(task.dueAt) : undefined)
        ? task.timeZone
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
    suggestedPerson: person,
    references: task.references,
  };
  const command = revisionCommand(task, content, reason);
  return (
    <View style={{ gap: 6 }}>
      <Action
        label={
          editing
            ? uiText("Chiudi modifica")
            : task.responsible
              ? uiText("Proponi una modifica")
              : uiText("Modifica attività")
        }
        onPress={() => edit(!editing)}
        disabled={disabled}
      />
      {editing && (
        <>
          <Field
            label={uiText("Titolo attività")}
            value={title}
            onChangeText={setTitle}
            maxLength={160}
          />
          <Field
            label={uiText("Descrizione")}
            value={description}
            onChangeText={setDescription}
            maxLength={8000}
            multiline
          />
          {due && (
            <DateField label={uiText("Scadenza")} value={due} change={setDue} />
          )}
          <Action
            label={
              due ? uiText("Rimuovi scadenza") : uiText("Aggiungi scadenza")
            }
            onPress={() => setDue(due ? null : new Date(Date.now() + 3600000))}
          />
          <Text style={{ color: c.muted }}>{uiText("Persona suggerita")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {[{ id: null, name: "Nessuno" }, ...members].map((m) => (
              <Action
                key={m.id ?? "none"}
                label={m.name}
                primary={m.id === person}
                onPress={() => setPerson(m.id)}
              />
            ))}
          </View>
          <Field
            label={uiText("Motivo della modifica")}
            value={reason}
            onChangeText={setReason}
            maxLength={2000}
          />
          <Action
            label={
              task.responsible
                ? uiText("Invia proposta di modifica")
                : uiText("Salva modifica")
            }
            disabled={disabled || !command}
            onPress={async () => {
              if (command && (await send("Modifica attività", command)))
                edit(false);
            }}
          />
        </>
      )}
      {proposals
        .filter(
          (proposal) =>
            proposal.taskId === task.id &&
            proposal.baseVersion === task.version,
        )
        .map((proposal) => {
          const data = proposal.content,
            adopt = adoptionCommand(task, proposal, actorId);
          return (
            <View
              key={proposal.id}
              style={{
                gap: 4,
                borderLeftColor: c.line,
                borderLeftWidth: 2,
                paddingLeft: 8,
              }}
            >
              <Text style={{ color: c.muted }}>
                {uiText("Proposta di ")}
                {name(proposal.actor)}
                {uiText(" · versione")} {proposal.baseVersion}
              </Text>
              <Text style={{ color: c.text, fontWeight: "600" }}>
                {data.title}
              </Text>
              {!!data.description && (
                <Text style={{ color: c.text }}>{data.description}</Text>
              )}
              <Text style={{ color: c.text }}>
                {data.dueAt
                  ? uiText(
                      "Scadenza · {0} · {1}",
                      String(
                        new Date(data.dueAt).toLocaleString(locale, {
                          timeZone: data.timeZone,
                        }),
                      ),
                      String(data.timeZone),
                    )
                  : uiText("Senza scadenza")}
              </Text>
              <Text style={{ color: c.text }}>
                {uiText("Persona suggerita ·")}{" "}
                {data.suggestedPerson
                  ? name(data.suggestedPerson)
                  : uiText("Nessuno")}
              </Text>
              {data.references.map((ref) => (
                <Text
                  key={ref.kind + ref.id + ref.version}
                  style={{ color: c.muted }}
                >
                  {ref.kind} · {ref.id}
                  {uiText(" · v")}
                  {ref.version}
                </Text>
              ))}
              <Text style={{ color: c.muted }}>{proposal.reason}</Text>
              {adopt && (
                <Action
                  label={uiText("Accetta la revisione")}
                  disabled={disabled}
                  onPress={() =>
                    Alert.alert(
                      uiText("Accettare questa revisione?"),
                      uiText(
                        "Assumi personalmente la responsabilità della nuova versione di «{0}».",
                        String(data.title),
                      ),
                      [
                        { text: uiText("Annulla"), style: "cancel" },
                        {
                          text: uiText("Accetta"),
                          onPress: () => {
                            void send("Accetta la revisione", adopt);
                          },
                        },
                      ],
                    )
                  }
                />
              )}
            </View>
          );
        })}
    </View>
  );
}
