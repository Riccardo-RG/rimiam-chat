import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import { z } from "zod";
import {
  collaborationModeLabels as rhythm,
  workspaceChangeLabels,
} from "../../../src/shared/workspace-labels";
import type { AttentionView } from "../../../src/contracts/attention";
import type { historySchema } from "../../../src/contracts/v1";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import { addressMiriam } from "../../../src/shared/miriam-address";
import type { NativeRequest } from "../api";
import { useResource } from "../useResource";
import { Action, Field, usePalette } from "../ui";
import type { Commands } from "./useCommands";

type Topic = AttentionView["workstreams"][number];
const stateNames = {
  proposed: "Proposto",
  active: "Attivo",
  resolved: "Concluso",
  archived: "Archiviato",
};
const options = {
  proposed: ["activate", "archive"],
  active: ["resolve", "archive"],
  resolved: ["reopen", "archive"],
  archived: ["restore"],
} as const;
const actionNames = {
  activate: "Attiva",
  archive: "Archivia",
  resolve: "Segna come concluso",
  reopen: "Riapri",
  restore: "Ripristina",
};
type Props = {
  request: NativeRequest;
  path: string;
  commands: Commands;
  snapshot: Snapshot;
  canWrite: boolean;
  onOpenConversation?: (topic: {
    id: string;
    version: number;
    title: string;
    state: string;
  }) => void;
  initialId?: string;
  scope?: "topics" | "rhythm";
  onMessage: (id: string) => void;
};
export function Topics(props: Props) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const { request, path, commands, snapshot, canWrite, onMessage, initialId } =
    props;
  const p = usePalette();
  const data = useResource<AttentionView>(
    request,
    path + "/attention?limit=30&rev=" + snapshot.workspace.revision,
  );
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [edit, setEdit] = useState<{
      id?: string;
      version?: number;
      title: string;
      description: string;
    } | null>(null),
    [showAll, setShowAll] = useState(false),
    [history, setHistory] = useState(false),
    [activity, setActivity] = useState(false);
  const topic = data.value?.workstreams.find((t) => t.id === selected);
  const disabled =
    !canWrite || commands.working || !commands.ready || !!commands.pending;
  async function save() {
    if (!edit) return;
    const success = await commands.send({
      kind: "command",
      label: "Salva argomento",
      command: {
        type: "workstream.save",
        id: edit.id,
        expectedVersion: edit.version,
        title: edit.title.trim(),
        description: edit.description.trim(),
      },
    });
    if (success) {
      setEdit(null);
      data.refresh();
    }
  }
  if (props.scope === "rhythm") {
    if (data.error)
      return (
        <>
          <Text style={{ color: p.text }}>{data.error}</Text>
          <Action label={uiText("Riprova")} onPress={data.refresh} />
        </>
      );
    if (!data.value)
      return <Text style={{ color: p.muted }}>{uiText("Caricamento…")}</Text>;
    return (
      <TopicActivity
        {...{ commands, canWrite }}
        view={data.value}
        refresh={data.refresh}
        onlyRhythm
      />
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {data.error && (
        <>
          <Text style={{ color: p.text }}>{data.error}</Text>
          <Action label={uiText("Riprova")} onPress={data.refresh} />
        </>
      )}
      {edit ? (
        <>
          <Field
            label={uiText("Nome dell’argomento")}
            maxLength={160}
            value={edit.title}
            onChangeText={(title) => setEdit({ ...edit, title })}
          />
          <Field
            label={uiText("Descrizione (facoltativa)")}
            maxLength={4000}
            multiline
            value={edit.description}
            onChangeText={(description) => setEdit({ ...edit, description })}
          />
          <Action
            label={uiText("Salva argomento")}
            primary
            disabled={disabled || !edit.title.trim()}
            onPress={() => void save()}
          />
          <Action label={uiText("Annulla")} onPress={() => setEdit(null)} />
        </>
      ) : topic ? (
        <>
          <Action
            label={uiText("‹ Tutti gli argomenti")}
            onPress={() => {
              setSelected(null);
              setHistory(false);
            }}
          />
          <Text style={{ color: p.text, fontSize: 20, fontWeight: "700" }}>
            {topic.title}
          </Text>
          <Text style={{ color: p.muted }}>
            {uiText(stateNames[topic.state])}
            {uiText(" · v")}
            {topic.version}
          </Text>
          {!!topic.description && (
            <Text selectable style={{ color: p.text }}>
              {topic.description}
            </Text>
          )}
          {canWrite && (
            <>
              <Action
                label={uiText("Modifica argomento")}
                disabled={disabled}
                onPress={() =>
                  setEdit({
                    id: topic.id,
                    version: topic.version,
                    title: topic.title,
                    description: topic.description,
                  })
                }
              />
              {options[topic.state].map((action) => (
                <Action
                  key={action}
                  label={uiText(actionNames[action])}
                  disabled={disabled}
                  onPress={() =>
                    Alert.alert(
                      uiText(
                        "{0} l’argomento?",
                        String(uiText(actionNames[action])),
                      ),
                      topic.title,
                      [
                        { text: uiText("Annulla"), style: "cancel" },
                        {
                          text: uiText("Conferma"),
                          onPress: () =>
                            void commands.send({
                              kind: "command",
                              label: uiText(actionNames[action]),
                              command: {
                                type: "workstream.transition",
                                workstreamId: topic.id,
                                expectedVersion: topic.version,
                                action,
                              },
                            }),
                        },
                      ],
                    )
                  }
                />
              ))}
            </>
          )}
          <Action
            label={
              history
                ? uiText("Chiudi cronologia")
                : uiText("Cronologia e fonti")
            }
            onPress={() => setHistory(!history)}
          />
          {history && (
            <>
              {topic.history.map((h) => (
                <Text key={h.version} style={{ color: p.muted }}>
                  {uiText("v")}
                  {h.version} · {h.title} ·{" "}
                  {new Date(h.createdAt).toLocaleDateString(locale)}
                </Text>
              ))}
              {topic.sources
                .filter((f) => f.included)
                .map((f) => (
                  <View key={f.id} style={{ gap: 4 }}>
                    <Text selectable style={{ color: p.text }}>
                      {f.content}
                    </Text>
                    {canWrite && (
                      <Action
                        label={uiText("Togli da questo argomento")}
                        disabled={disabled}
                        onPress={async () => {
                          if (
                            await commands.send({
                              kind: "command",
                              label: "Togli collegamento",
                              command: {
                                type: "workstream.link",
                                workstreamId: topic.id,
                                sourceId: f.id,
                                expectedVersion: f.version,
                                included: false,
                              },
                            })
                          )
                            data.refresh();
                        }}
                      />
                    )}
                  </View>
                ))}
            </>
          )}
          {props.onOpenConversation ? (
            <Action
              variant="quiet"
              icon="chat"
              label={uiText("Apri nella conversazione")}
              onPress={() => props.onOpenConversation?.(topic)}
            />
          ) : (
            <TopicConversation
              key={topic.id}
              request={request}
              path={path}
              topic={topic}
              commands={commands}
              canWrite={canWrite}
              onMessage={onMessage}
              through={snapshot.messages.at(-1)?.sequence ?? 0}
            />
          )}
        </>
      ) : (
        <>
          {canWrite && (
            <Action
              label={uiText("Nuovo argomento")}
              primary
              disabled={disabled}
              onPress={() => setEdit({ title: "", description: "" })}
            />
          )}
          <Action
            label={
              showAll
                ? uiText("Mostra solo gli attivi")
                : uiText("Mostra anche conclusi e archiviati")
            }
            onPress={() => setShowAll(!showAll)}
          />
          {data.value?.workstreams
            .filter((t) => showAll || t.state === "active")
            .map((t) => (
              <Action
                key={t.id}
                label={t.title + " · " + uiText(stateNames[t.state])}
                onPress={() => setSelected(t.id)}
              />
            ))}
          {data.value && !props.scope && (
            <>
              <Action
                label={
                  activity
                    ? uiText("Chiudi attività e preferenze")
                    : uiText("Attività e preferenze")
                }
                onPress={() => setActivity(!activity)}
              />
              {activity && (
                <TopicActivity
                  view={data.value}
                  canWrite={canWrite}
                  commands={commands}
                  refresh={data.refresh}
                />
              )}
            </>
          )}
          {data.value &&
            !data.value.workstreams.some(
              (t) => showAll || t.state === "active",
            ) && (
              <Text style={{ color: p.muted }}>
                {uiText("Nessun argomento in questa vista.")}
              </Text>
            )}
        </>
      )}
    </View>
  );
}
function TopicActivity({
  view,
  canWrite,
  commands,
  refresh,
  onlyRhythm = false,
}: {
  onlyRhythm?: boolean;
  view: AttentionView;
  canWrite: boolean;
  commands: Commands;
  refresh: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const busy = commands.working || !!commands.pending || !commands.ready;
  return (
    <View style={{ gap: 6 }}>
      {!onlyRhythm && (
        <>
          <Text style={{ color: p.text, fontWeight: "600" }}>
            {uiText("Cambiamenti recenti")}
          </Text>
          {view.changes
            .filter((change) => change.revision > view.alignedRevision)
            .map((change) => (
              <Text key={change.revision} style={{ color: p.muted }}>
                {uiText(
                  workspaceChangeLabels[change.kind.split(".")[0]] ?? "",
                ) || uiText("Aggiornamento dello spazio")}{" "}
                · {new Date(change.createdAt).toLocaleString(locale)}
              </Text>
            ))}
          {view.revision > view.alignedRevision && (
            <Action
              label={uiText("Sono allineato fino a qui")}
              disabled={busy}
              onPress={async () => {
                if (
                  await commands.send({
                    kind: "command",
                    label: "Segna il punto di allineamento",
                    command: {
                      type: "attention.aligned",
                      revision: view.revision,
                    },
                  })
                )
                  refresh();
              }}
            />
          )}
        </>
      )}
      <Text style={{ color: p.text }}>
        {uiText("Ritmo di Emme · ")}
        {uiText(rhythm[view.preference.mode])}
      </Text>
      {canWrite &&
        (
          Object.entries(rhythm) as [
            AttentionView["preference"]["mode"],
            string,
          ][]
        ).map(([mode, label]) => (
          <Action
            key={mode}
            label={uiText(label)}
            disabled={busy || mode === view.preference.mode}
            onPress={async () => {
              if (
                await commands.send({
                  kind: "command",
                  label: "Ritmo di Emme",
                  command: {
                    type: "attention.preference",
                    mode,
                    expectedVersion: view.preference.version,
                  },
                })
              )
                refresh();
            }}
          />
        ))}
    </View>
  );
}
function TopicConversation({
  request,
  path,
  topic,
  through,
  commands,
  canWrite,
  onMessage,
}: {
  request: NativeRequest;
  path: string;
  topic: Topic;
  through: number;
  commands: Commands;
  canWrite: boolean;
  onMessage: (id: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const [before, setBefore] = useState<number>(),
    [draft, setDraft] = useState<{ text: string; version: number }>({
      text: "",
      version: topic.version,
    });
  const page = useResource<z.infer<typeof historySchema>>(
    request,
    path +
      "/history?workstreamId=" +
      topic.id +
      "&limit=30&through=" +
      through +
      (before !== undefined ? "&before=" + before : ""),
  );
  const stale = !!draft.text && draft.version !== topic.version;
  const disabled =
    !canWrite ||
    commands.working ||
    !!commands.pending ||
    !commands.ready ||
    stale ||
    topic.state !== "active" ||
    !draft.text.trim();
  async function send(ask: boolean) {
    if (disabled) return;
    const content = ask ? addressMiriam(draft.text.trim()) : draft.text.trim();
    if (content.length > 12000) return;
    if (
      await commands.send({
        kind: "command",
        label: "Messaggio nell’argomento",
        command: {
          type: "message.send",
          content,
          workstreamFocus: { workstreamId: topic.id, version: draft.version },
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
    ) {
      setDraft({ text: "", version: topic.version });
      setBefore(undefined);
      page.refresh();
    }
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text, fontWeight: "700" }}>
        {uiText("Conversazione sull’argomento")}
      </Text>
      {page.error && <Text style={{ color: c.text }}>{page.error}</Text>}
      {page.value?.hasMore && (
        <Action
          label={uiText("Messaggi precedenti")}
          onPress={() => setBefore(page.value!.nextBefore)}
        />
      )}
      {before !== undefined && (
        <Action
          label={uiText("Torna ai più recenti")}
          onPress={() => setBefore(undefined)}
        />
      )}
      {page.value?.messages.map((m) => (
        <View key={m.id} style={{ paddingVertical: 4 }}>
          <Text style={{ color: c.muted }}>{m.authorName}</Text>
          <Text selectable style={{ color: c.text }}>
            {m.content}
          </Text>
          <Action
            label={uiText("Vai al messaggio")}
            onPress={() => onMessage(m.id)}
          />
        </View>
      ))}
      {topic.state === "active" && canWrite && (
        <>
          <Field
            multiline
            label={uiText("Scrivi nell’argomento")}
            value={draft.text}
            maxLength={11990}
            onChangeText={(text) =>
              setDraft({
                text,
                version: draft.text ? draft.version : topic.version,
              })
            }
          />
          {stale && (
            <Action
              label={uiText("Usa la bozza nella versione aggiornata")}
              onPress={() => setDraft({ ...draft, version: topic.version })}
            />
          )}
          <Action
            primary
            label={uiText("Invia")}
            disabled={disabled}
            onPress={() => void send(false)}
          />
          <Action
            label={uiText("Chiedi a Emme")}
            disabled={disabled}
            onPress={() => void send(true)}
          />
        </>
      )}
    </View>
  );
}
