import { useUiLanguage } from "../i18n";
import React, { useState, useMemo } from "react";
import { View, ScrollView, Text } from "react-native";
import type { ConversationReference } from "../../../src/contracts/activity";
import { Artifacts, Composer } from "../workspace/Artifacts";
import type { ChatState } from "../../../src/contracts/personal-chats";
import type { NativeRequest } from "../api";
import { Action, usePalette } from "../ui";
import { useWorkspace } from "../workspace/useWorkspace";
import { useCommands } from "../workspace/useCommands";
import { PendingStrip } from "../workspace/PendingStrip";
import { Schedule } from "../workspace/Schedule";
import { workspacePath, type Attachment } from "../workspace/commands";
import {
  SharedFiles,
  FilePanel,
  Panel,
  ReferencePanel,
} from "../workspace/SharedFiles";
import { Attachments } from "../workspace/Attachments";
export function PersonalReminders({
  archive,
  request,
  actorId,
  origin,
}: {
  archive: string;
  request: NativeRequest;
  actorId: string;
  origin: string;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const view = useWorkspace(request, archive);
  const scope = useMemo(
    () => ({ workspaceId: archive, actorId, origin }),
    [archive, actorId, origin],
  );
  const commands = useCommands(request, scope, view.refresh);
  const member = view.snapshot?.members.find((m) => m.user_id === actorId);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 14, gap: 9 }}
    >
      <PendingStrip commands={commands} />
      {view.error && (
        <>
          <Text accessibilityRole="alert" style={{ color: c.text }}>
            {view.error}
          </Text>
          <Action label={uiText("Riprova")} onPress={view.refresh} />
        </>
      )}
      {!view.snapshot && !view.error && (
        <Text style={{ color: c.muted }}>
          {uiText("Caricamento dei promemoria…")}
        </Text>
      )}
      {view.snapshot && (
        <Schedule
          personal
          path={workspacePath(archive)}
          actorId={actorId}
          request={request}
          commands={commands}
          canWrite={!!member?.active && member.contributes}
          revision={String(view.snapshot.workspace.revision)}
        />
      )}
    </ScrollView>
  );
}
export function PersonalFiles({
  archive,
  actorId,
  origin,
  request,
  state,
  onClose,
}: {
  archive: string;
  actorId: string;
  origin: string;
  request: NativeRequest;
  state: ChatState;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const view = useWorkspace(request, archive);
  const [documents, setDocuments] = useState<"compose" | "browse" | null>(null);
  const [reference, setReference] = useState<ConversationReference | null>(
    null,
  );
  const [fileId, setFileId] = useState<string | null>(null);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const original = view.snapshot?.messages.find((m) => m.id === originalId);
  const [copy, setCopy] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [upload, setUpload] = useState(false);
  const scope = useMemo(
    () => ({ workspaceId: archive, actorId, origin }),
    [archive, actorId, origin],
  );
  const commands = useCommands(request, scope, () => {
    view.refresh();
    setCopy(null);
    setFiles([]);
    setUpload(false);
  });
  const file = view.snapshot?.sources.find(
    (f) => (!f.withdrawn || f.can_manage_visibility) && f.id === fileId,
  );
  const source = view.snapshot?.sources.find(
    (f) => !f.withdrawn && f.id === copy,
  );
  const targets = state.targets.filter((t) => t.contributes);
  const target = targets.find((t) => t.id === destination);
  return (
    <View style={{ flex: 1, padding: 10, gap: 8 }}>
      {documents !== "compose" && (
        <Action
          label={uiText(
            documents ? "Torna al raccoglitore" : "Torna alla conversazione",
          )}
          variant="quiet"
          onPress={documents ? () => setDocuments(null) : onClose}
        />
      )}
      {view.error && <Text style={{ color: p.text }}>{view.error}</Text>}
      <PendingStrip commands={commands} />
      {view.snapshot &&
        (documents ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8 }}
          >
            {documents === "compose" ? (
              <Composer
                state={view.snapshot}
                commands={commands}
                onClose={() => setDocuments(null)}
              />
            ) : (
              <Artifacts
                state={view.snapshot}
                actor={actorId}
                commands={commands}
                canWrite={false}
                onRef={setReference}
              />
            )}
          </ScrollView>
        ) : (
          <SharedFiles
            identity={{ actorId, origin }}
            commands={commands}
            onMessage={setOriginalId}
            request={request}
            snapshot={view.snapshot}
            open={(f) => setFileId(f.id)}
            onAttach={() => setUpload(true)}
            onNewDocument={() => setDocuments("compose")}
            onDocuments={() => setDocuments("browse")}
          />
        ))}
      {reference && (
        <ReferencePanel
          refValue={reference}
          request={request}
          path={workspacePath(archive)}
          snapshot={view.snapshot ?? undefined}
          onClose={() => setReference(null)}
          onMessage={(id) => {
            setReference(null);
            setOriginalId(id);
          }}
        />
      )}
      {file && (
        <>
          <FilePanel
            personal
            canWrite
            file={file}
            request={request}
            workspaceId={archive}
            commands={commands}
            onClose={() => setFileId(null)}
            onMessage={(id) => {
              setFileId(null);
              setOriginalId(id);
            }}
            extraAction={
              <Action
                label={uiText("Condividi in uno spazio…")}
                onPress={() => {
                  setCopy(file.id);
                  setDestination(file.origin_workspace_id ?? null);
                  setFileId(null);
                }}
              />
            }
          />
        </>
      )}
      {originalId && (
        <Panel
          title={uiText("Messaggio originale")}
          onClose={() => setOriginalId(null)}
        >
          {original ? (
            <ScrollView contentContainerStyle={{ gap: 8 }}>
              <Text style={{ color: p.muted }}>
                {original.author_name} ·{" "}
                {new Date(original.created_at).toLocaleString(locale)}
              </Text>
              {!!original.content && (
                <Text selectable style={{ color: p.text, fontSize: 17 }}>
                  {original.content}
                </Text>
              )}
              {view.snapshot?.sources
                .filter(
                  (s) => s.shared_message_id === original.id && !s.withdrawn,
                )
                .map((s) => (
                  <Action
                    key={s.id}
                    label={s.filename ?? s.title}
                    onPress={() => {
                      setOriginalId(null);
                      setFileId(s.id);
                    }}
                  />
                ))}
            </ScrollView>
          ) : (
            <Text style={{ color: p.muted }}>
              {uiText(
                "Il messaggio originale non è disponibile nell’archivio.",
              )}
            </Text>
          )}
        </Panel>
      )}
      {source && (
        <Panel
          title={uiText("Condividi documento")}
          onClose={() => setCopy(null)}
        >
          <ScrollView contentContainerStyle={{ gap: 9 }}>
            <Text style={{ color: p.text }}>
              {source.filename ?? source.title}
            </Text>
            {targets.map((t) => (
              <Action
                key={t.id}
                label={t.name}
                primary={destination === t.id}
                onPress={() => setDestination(t.id)}
              />
            ))}
            {target && (
              <Action
                label={uiText("Condividi in {0}", String(target.name))}
                primary
                disabled={
                  !commands.ready || commands.working || !!commands.pending
                }
                onPress={() =>
                  void commands.send({
                    kind: "command",
                    label: "Condividi documento in " + target.name,
                    command: {
                      type: "library.copy",
                      sourceId: source.id,
                      destinationId: target.id,
                    },
                  })
                }
              />
            )}
            <PendingStrip commands={commands} />
          </ScrollView>
        </Panel>
      )}
      {upload && (
        <Panel
          title={uiText("Aggiungi ai documenti personali")}
          onClose={() => setUpload(false)}
        >
          <ScrollView contentContainerStyle={{ gap: 10 }}>
            <Attachments files={files} onChange={setFiles} />
            <Action
              label={uiText("Salva nei miei documenti")}
              primary
              disabled={
                !commands.ready ||
                commands.working ||
                !!commands.pending ||
                !files.length
              }
              onPress={() =>
                void commands.send({
                  kind: "command",
                  label: "Documenti personali",
                  files,
                  command: { type: "message.send", content: "" },
                })
              }
            />
            <PendingStrip commands={commands} />
          </ScrollView>
        </Panel>
      )}
    </View>
  );
}
