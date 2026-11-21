import { useUiLanguage } from "../i18n";
import { ToolHeader, ToolRow } from "./ToolLayout";
import {
  destinations,
  index,
  type Destination,
} from "../../../src/shared/workspace-navigation";
import { workspaceGuideTopics } from "../../../src/shared/workspace-guide-topics";
import { availableComposerActions } from "../../../src/shared/composer-actions";
import { Artifacts } from "./Artifacts";
import { Project } from "./Project";
import { Access } from "./Access";
import { PeopleDirectory } from "./PeopleDirectory";
import type { PhotoDirectory } from "../../../src/contracts/identity-photos";
import { LinkedSpaces, MemberInvite } from "./PeopleWorkspace";
import React, { useEffect, useCallback, useState } from "react";
import { BackHandler, ScrollView, Switch, Text, View } from "react-native";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { ConversationReference } from "../../../src/contracts/activity";
import { Work } from "./Work";
import type { Command } from "../../../src/contracts/commands";
import { type NativeRequest } from "../api";
import { Action, Field, usePalette } from "../ui";
import type { ConsultationRef } from "../../../src/contracts/private-consultation";
import { Consultation } from "./Consultation";
import { researchStatusLabels } from "../../../src/shared/workspace-labels";
import { ActivityRegister } from "./ActivityRegister";
import { ProtectedImage } from "../ProtectedImage";
import { isSharedPhoto } from "../../../src/shared/photo-media-type";
import { Pressable } from "react-native";
import { SourceUpload } from "./SourceUpload";
import { CandidateActions } from "./CandidateActions";
import { Questions } from "./Questions";
import { Topics } from "./Topics";
import { Schedule } from "./Schedule";
import { Feedback } from "./Feedback";
import type { Commands } from "./useCommands";

const sectionFor = {
  work: "In programma",
  context: "Contesto",
  people: "Persone",
  goal: "Direzione",
  attention: "Attività e argomenti",
  sources: "Ricerca web",
  feedback: "Feedback beta",
  notifications: "Notifiche",
  guide: "Guida e comandi",
} as const;
export type Tool =
  | (typeof sectionFor)[keyof typeof sectionFor]
  | "Argomenti"
  | "Attività di Emme"
  | "Documenti di lavoro"
  | "Domande"
  | "Invita una persona";
const titles: Partial<Record<Tool, string>> = {
  Persone: "Persone e accesso",
  Contesto: "Contesto condiviso",
  Direzione: "La direzione",
  Domande: "Domande aperte",
  "Ricerca web": "Fonti e ricerca",
  Notifiche: "Notifiche su questo dispositivo",
  "Guida e comandi": "Guida dello spazio",
};
export function WorkspaceTools({
  request,
  path,
  actorId,
  snapshot,
  commands,
  onRef,
  onClose,
  headerActions,
  photos,
  onPerson,
  onParent,
  onShared,
  onFile,
  onIntegration,
  openWorkspace,
  onMessage,
  onOpenTopic,
  onConsultReference,
  children,
  refreshKey,
  initialSection,
  prepareTask,
  itemId,
}: {
  request: NativeRequest;
  path: string;
  actorId: string;
  snapshot: Snapshot;
  commands: Commands;
  onClose?: () => void;
  headerActions?: React.ReactNode;
  onParent?: { label: string; open: () => void };
  photos?: PhotoDirectory;
  onPerson: (id: string, name: string) => void;
  onShared?: () => void;
  onFile?: (id: string) => void;
  onRef: (ref: ConversationReference) => void;
  openWorkspace: (id: string, name: string) => void;
  onIntegration: (kind: "email" | "calendar") => void;
  onMessage: (id: string) => void;
  onOpenTopic?: (stream: {
    id: string;
    version: number;
    title: string;
    state: string;
  }) => void;
  onConsultReference: (r: ConsultationRef) => void;
  children: React.ReactNode;
  refreshKey: number;
  initialSection?: Tool;
  prepareTask?: boolean;
  itemId?: string;
}) {
  const { t: uiText, locale: guideLocale } = useUiLanguage();
  const p = usePalette();
  const [section, setSection] = useState<Tool | null>(initialSection ?? null);
  const member = snapshot.members.find((m) => m.user_id === actorId);
  const canWrite = !!member?.active && member.contributes;
  const disabled =
    !canWrite || !commands.ready || commands.working || !!commands.pending;
  const send = (label: string, command: Command) => {
    void commands.send({ kind: "command", label, command });
  };
  const [detail, setDetail] = useState("");
  const [sourceCount, setSourceCount] = useState(8);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [edit, setEdit] = useState(false);
  const [goalBase, setGoalBase] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const goal = snapshot.goals.find((g) => g.current_primary);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<(Tool | null)[]>([]);
  function show(s: Tool | null) {
    setSection(s);
    setDetail("");
    setDraft("");
    setConfirm(false);
    setEdit(false);
    setGoalBase(null);
    setSelected(null);
  }
  function choose(s: Tool) {
    setHistory((prev) => [...prev, section]);
    show(s);
  }
  const previous = history.at(-1);
  const up = useCallback(() => {
    if (previous === undefined) return;
    setHistory((prev) => prev.slice(0, -1));
    show(previous);
  }, [previous]);
  const back = previous !== undefined ? up : onParent?.open;
  useEffect(() => {
    if (!onClose) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      (back ?? onClose)();
      return true;
    });
    return () => sub.remove();
  }, [back, onClose]);
  const backLabel =
    previous === undefined
      ? onParent?.label
      : previous === null
        ? uiText("Indice dello spazio")
        : uiText("Torna a {0}", uiText(titles[previous] ?? previous));
  useEffect(() => {
    setHistory([]);
    show(initialSection ?? null);
    if (initialSection === "Ricerca web" && itemId === "ricerca")
      setDetail("research");
    if (initialSection === "Ricerca web" && itemId === "carica")
      setDetail("upload");
  }, [initialSection, itemId]);
  const permittedInvite = snapshot.access.some(
    (r) => r.active && r.holder_id === actorId && r.invitations,
  );
  function go(id: Destination) {
    if (id === "") onClose?.();
    else if (id === "calendar" || id === "email") onIntegration(id);
    else if (id === "artifacts") {
      if (onShared) onShared();
      else choose("Documenti di lavoro");
    } else choose(sectionFor[id]);
  }
  function expandable(key: string, label: string) {
    return (
      <ToolRow
        label={uiText(label)}
        expanded={detail === key}
        onPress={() => setDetail(detail === key ? "" : key)}
      />
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      {onClose && (
        <ToolHeader
          title={
            section
              ? uiText(titles[section] ?? section)
              : uiText("Dentro il vostro spazio")
          }
          onClose={onClose}
          headerActions={headerActions}
          onBack={back}
          backLabel={backLabel}
          contextName={snapshot.workspace.name}
        />
      )}
      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 12 }}
      >
        {!onClose && back && (
          <ToolRow
            label={backLabel ?? uiText("Indice dello spazio")}
            onPress={back}
          />
        )}
        {!section && (
          <>
            {onClose && (
              <ToolRow label={uiText("Chat")} icon="chat" onPress={onClose} />
            )}
            {index.map((group) => (
              <View key={group.title} style={{ gap: 2 }}>
                <Text
                  accessibilityRole="header"
                  style={{ color: p.muted, fontWeight: "600", marginTop: 8 }}
                >
                  {uiText(group.title)}
                </Text>
                {group.views.map((id) => (
                  <ToolRow
                    key={id}
                    icon={destinations[id][1]}
                    label={uiText(destinations[id][0])}
                    onPress={() => go(id)}
                    disabled={
                      (id === "email" || id === "calendar") &&
                      !!commands.pending
                    }
                  />
                ))}
              </View>
            ))}
          </>
        )}
        {section === "Attività e argomenti" && (
          <>
            {expandable("register", "Registro attività")}
            {detail === "register" && (
              <ActivityRegister
                request={request}
                path={path}
                onReference={onRef}
              />
            )}
            {expandable("topics", "Argomenti della conversazione")}
            {detail === "topics" && (
              <Topics
                {...{ request, path, commands, snapshot, canWrite, onMessage }}
                scope="topics"
                onOpenConversation={onOpenTopic}
              />
            )}
            {expandable("rhythm", "Il ritmo di Emme")}
            {detail === "rhythm" && (
              <Topics
                {...{ request, path, commands, snapshot, canWrite, onMessage }}
                scope="rhythm"
              />
            )}
          </>
        )}
        {section === "Guida e comandi" && (
          <>
            <Text
              accessibilityRole="header"
              style={{ color: p.text, fontSize: 19, fontWeight: "600" }}
            >
              {uiText("Comandi della chat")}
            </Text>
            <Text style={{ color: p.muted }}>
              {uiText(
                "Digita / nella chat e scegli una voce. Ogni azione apre lo strumento o prepara una bozza da completare.",
              )}
            </Text>
            {availableComposerActions(
              {
                canContribute: canWrite,
                canInvite: permittedInvite,
              },
              "",
              guideLocale,
            ).map((action) => (
              <View key={action.id} style={{ gap: 2 }}>
                <Text style={{ color: p.text, fontWeight: "600" }}>
                  {action.shortcuts.join(" · ")}
                </Text>
                <Text style={{ color: p.muted }}>{action.description}</Text>
              </View>
            ))}
            <Text
              accessibilityRole="header"
              style={{ color: p.text, fontSize: 19, fontWeight: "600" }}
            >
              {uiText("Come funziona lo spazio")}
            </Text>
            {workspaceGuideTopics.map(([title, body]) => (
              <View key={title}>
                {expandable(title, title)}
                {detail === title && (
                  <Text
                    style={{
                      color: p.text,
                      lineHeight: 23,
                      paddingVertical: 8,
                    }}
                  >
                    {uiText(body)}
                  </Text>
                )}
              </View>
            ))}
          </>
        )}
        {section === "Invita una persona" &&
          (permittedInvite ? (
            <MemberInvite
              request={request}
              commands={commands}
              snapshot={snapshot}
            />
          ) : (
            <Text style={{ color: p.muted }}>
              {uiText(
                "Il tuo accesso attuale non consente di invitare persone.",
              )}
            </Text>
          ))}
        {section === "In programma" && (
          <>
            <Schedule
              prepareTask={prepareTask}
              focusId={initialSection === "In programma" ? itemId : undefined}
              canWrite={canWrite}
              request={request}
              path={path}
              actorId={actorId}
              commands={commands}
              revision={snapshot.workspace.revision + "." + refreshKey}
            />
            <ToolRow
              label={uiText("Il lavoro di Emme")}
              icon="work"
              onPress={() => choose("Attività di Emme")}
            />
          </>
        )}
        {section === "Domande" && (
          <Questions
            {...{ snapshot, commands, onRef, canWrite }}
            initialSource={initialSection === "Domande" ? itemId : undefined}
          />
        )}
        {section === "Argomenti" && (
          <Topics
            onOpenConversation={onOpenTopic}
            initialId={initialSection === "Argomenti" ? itemId : undefined}
            request={request}
            path={path}
            commands={commands}
            snapshot={snapshot}
            canWrite={canWrite}
            onMessage={onMessage}
          />
        )}
        {section === "Direzione" && (
          <>
            <Text style={{ color: p.text, fontSize: 18 }}>
              {goal?.content ?? uiText("Lo spazio non ha ancora un obiettivo.")}
            </Text>
            {canWrite && !edit && (
              <Action
                label={
                  goal
                    ? uiText("Modifica obiettivo")
                    : uiText("Definisci obiettivo")
                }
                onPress={() => {
                  setDraft(goal?.content ?? "");
                  setGoalBase(
                    goal
                      ? { id: goal.id, version: goal.current_version }
                      : null,
                  );
                  setEdit(true);
                }}
              />
            )}
            {edit && (
              <>
                <Field
                  label={uiText("Obiettivo condiviso")}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  maxLength={2000}
                />
                <Action
                  label={uiText("Salva obiettivo")}
                  primary
                  disabled={disabled || !draft.trim()}
                  onPress={async () => {
                    const ok = await commands.send({
                      kind: "command",
                      label: "Obiettivo dello spazio",
                      command: goalBase
                        ? {
                            type: "goal.editShared",
                            goalId: goalBase.id,
                            expectedVersion: goalBase.version,
                            content: draft.trim(),
                          }
                        : { type: "goal.establish", content: draft.trim() },
                    });
                    if (ok) {
                      setEdit(false);
                      setGoalBase(null);
                    }
                  }}
                />
                <Action
                  label={uiText("Annulla")}
                  onPress={() => setEdit(false)}
                />
              </>
            )}
            <Project
              key={refreshKey}
              {...{ request, path, canWrite, send }}
              busy={commands.working || !!commands.pending || !commands.ready}
              actor={actorId}
            />
          </>
        )}
        {section === "Contesto" && (
          <>
            <Consultation
              path={path}
              request={request}
              actorId={actorId}
              canShare={canWrite}
              onReference={onConsultReference}
              onMessage={onMessage}
            />
            <Action
              label={
                edit
                  ? uiText("Chiudi riferimenti e proposte")
                  : uiText("Consulta riferimenti e proposte")
              }
              onPress={() => setEdit(!edit)}
            />
            {edit && (
              <>
                <Text style={{ color: p.muted }}>
                  {uiText("Riferimenti accettati dal gruppo")}
                </Text>
                {!snapshot.information.length && (
                  <Text style={{ color: p.text }}>
                    {uiText("Nessun riferimento accettato.")}
                  </Text>
                )}
                {snapshot.information.map((info) => (
                  <Action
                    key={info.id}
                    label={info.subject}
                    onPress={() =>
                      onRef({
                        kind: "information",
                        id: info.id,
                        version: info.current_version,
                      })
                    }
                  />
                ))}
                <Text style={{ color: p.muted }}>{uiText("Da valutare")}</Text>
                {snapshot.candidates
                  .filter(
                    (c) =>
                      !c.uses.information.length &&
                      !c.uses.questions.length &&
                      !c.uses.proposals.length,
                  )
                  .map((c) => (
                    <View key={c.id} style={{ gap: 5 }}>
                      <Action
                        label={c.subject}
                        onPress={() =>
                          setSelected(selected === c.id ? null : c.id)
                        }
                      />
                      {selected === c.id && (
                        <>
                          <Text style={{ color: p.text }}>{c.content}</Text>
                          <Text style={{ color: p.muted }}>
                            {c.qualification}
                          </Text>
                          {Array.from(
                            new Set([c.source_id, ...c.source_ids]),
                          ).map((id, index) => (
                            <Action
                              key={id}
                              label={
                                index
                                  ? uiText(
                                      "Altra fonte · {0}",
                                      String(index + 1),
                                    )
                                  : uiText("Fonte originale")
                              }
                              onPress={() =>
                                onRef({ kind: "source", id, version: 1 })
                              }
                            />
                          ))}
                          {canWrite && (
                            <CandidateActions
                              candidate={c}
                              snapshot={snapshot}
                              commands={commands}
                              disabled={disabled}
                              actorId={actorId}
                            />
                          )}
                        </>
                      )}
                    </View>
                  ))}
              </>
            )}
            <ToolRow
              label={uiText("Domande aperte")}
              icon="context"
              onPress={() => choose("Domande")}
            />
          </>
        )}
        {section === "Persone" && (
          <>
            <PeopleDirectory
              key={snapshot.workspace.access_revision}
              {...{ request, path, snapshot, send, photos, onPerson }}
              actor={actorId}
              busy={commands.working || !commands.ready || !!commands.pending}
              onInvite={() => choose("Invita una persona")}
            />
            {!snapshot.workspace.personal && (
              <>
                {expandable("links", "Spazi collegati")}
                {detail === "links" && (
                  <LinkedSpaces
                    request={request}
                    commands={commands}
                    snapshot={snapshot}
                    canWrite={canWrite}
                    open={openWorkspace}
                  />
                )}
              </>
            )}
            <Access
              key={refreshKey}
              {...{ request, path, send }}
              actor={actorId}
              busy={commands.working || !commands.ready || !!commands.pending}
            />
          </>
        )}
        {section === "Attività di Emme" && (
          <Work
            actor={actorId}
            saved={snapshot.artifactVersions.flatMap((v) =>
              v.contribution_id ? [v.contribution_id] : [],
            )}
            request={request}
            path={path}
            disabled={disabled}
            refreshKey={refreshKey}
            send={send}
            onRef={onRef}
          />
        )}
        {section === "Documenti di lavoro" && (
          <Artifacts
            startNew={itemId === "new"}
            state={snapshot}
            actor={actorId}
            commands={commands}
            canWrite={canWrite}
            onRef={onRef}
          />
        )}
        {section === "Ricerca web" && (
          <>
            {canWrite && expandable("upload", "Carica un file")}
            {canWrite && detail === "upload" && (
              <SourceUpload commands={commands} />
            )}
            {canWrite && expandable("research", "Cerca sul web")}
            {canWrite && detail === "research" && (
              <>
                <Field
                  label={uiText("Termini da cercare")}
                  value={draft}
                  onChangeText={setDraft}
                  maxLength={500}
                />
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Switch
                    accessibilityLabel={uiText("Autorizzo invio della ricerca")}
                    value={confirm}
                    onValueChange={setConfirm}
                  />
                  <Text style={{ color: p.text, flex: 1 }}>
                    {uiText(
                      "Invia questi termini al servizio esterno di ricerca.",
                    )}
                  </Text>
                </View>
                <Action
                  label={uiText("Avvia ricerca")}
                  primary
                  disabled={disabled || !confirm || !draft.trim()}
                  onPress={() =>
                    send("Ricerca web", {
                      type: "research.request",
                      query: draft.trim(),
                      discloseQuery: true,
                    })
                  }
                />
              </>
            )}
            {snapshot.sources
              .filter((source) => !source.withdrawn)
              .slice(0, sourceCount)
              .map((file) => {
                const open = () =>
                  onFile && file.kind === "document"
                    ? onFile(file.id)
                    : onRef({
                        kind: "source",
                        id: file.id,
                        version: file.document_version ?? 1,
                      });
                return (
                  <View
                    key={file.id}
                    style={{
                      flexDirection: "row",
                      gap: 9,
                      alignItems: "center",
                    }}
                  >
                    {isSharedPhoto(file.media_type) && (
                      <Pressable
                        onPress={open}
                        accessibilityRole="button"
                        accessibilityLabel={uiText(
                          "Apri anteprima di {0}",
                          String(file.title),
                        )}
                      >
                        <ProtectedImage
                          request={request}
                          path={
                            path +
                            "/source-file?id=" +
                            encodeURIComponent(file.id)
                          }
                          mediaType={file.media_type!}
                          label={file.title}
                          style={{ width: 48, height: 48, borderRadius: 8 }}
                        />
                      </Pressable>
                    )}
                    <View style={{ flex: 1 }}>
                      <ToolRow
                        icon={
                          isSharedPhoto(file.media_type) ? undefined : "files"
                        }
                        label={file.filename ?? file.title}
                        onPress={open}
                      />
                    </View>
                  </View>
                );
              })}
            {snapshot.sources.filter((source) => !source.withdrawn).length >
              sourceCount && (
              <Action
                label={uiText("Altre fonti")}
                onPress={() => setSourceCount((n) => n + 12)}
              />
            )}
            {snapshot.sources.some(
              (source) => source.withdrawn && source.can_manage_visibility,
            ) && expandable("withdrawn", "File ritirati")}
            {detail === "withdrawn" &&
              snapshot.sources
                .filter(
                  (source) => source.withdrawn && source.can_manage_visibility,
                )
                .map((file) => (
                  <ToolRow
                    key={file.id}
                    label={file.filename ?? file.title}
                    onPress={() =>
                      onFile
                        ? onFile(file.id)
                        : onRef({
                            kind: "source",
                            id: file.id,
                            version: file.document_version ?? 1,
                          })
                    }
                  />
                ))}
            {snapshot.research.map((r) => (
              <View key={r.id} style={{ gap: 5 }}>
                <Text style={{ color: p.text }}>{r.query}</Text>
                <Text style={{ color: p.muted }}>
                  {uiText(researchStatusLabels[r.status] ?? "") || r.status}
                </Text>
                {r.requested_by === actorId && canWrite && (
                  <>
                    {["failed", "needs_configuration"].includes(r.status) && (
                      <Action
                        label={uiText("Riprova ricerca")}
                        disabled={disabled}
                        onPress={() =>
                          send("Riprova ricerca", {
                            type: "research.retry",
                            workId: r.id,
                          })
                        }
                      />
                    )}
                    {[
                      "queued",
                      "running",
                      "failed",
                      "needs_configuration",
                    ].includes(r.status) && (
                      <Action
                        label={uiText("Interrompi ricerca")}
                        disabled={disabled}
                        onPress={() =>
                          send("Interrompi ricerca", {
                            type: "research.cancel",
                            workId: r.id,
                          })
                        }
                      />
                    )}
                  </>
                )}
                {snapshot.sources
                  .filter((s) => s.work_id === r.id)
                  .map((source) => (
                    <Action
                      key={source.id}
                      label={source.title}
                      onPress={() =>
                        onRef({ kind: "source", id: source.id, version: 1 })
                      }
                    />
                  ))}
              </View>
            ))}
          </>
        )}
        {section === "Notifiche" && children}
        {section === "Feedback beta" && (
          <Feedback
            {...{ request, path, canWrite, commands }}
            revision={refreshKey}
          />
        )}
      </ScrollView>
    </View>
  );
}
