import { useUiLanguage } from "../i18n";
import { ChatViewport } from "../ChatViewport";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { feedbackFromComposer } from "../../../src/shared/beta-feedback";
import {
  conversationReferenceSchema,
  type ConversationReference,
} from "../../../src/contracts/activity";

import {
  addressMiriam,
  defaultQuotedQuestion,
} from "../../../src/shared/miriam-address";
import { useResource } from "../useResource";
import type { z } from "zod";
import type { voiceMessagesSchema } from "../../../src/contracts/voice";
import type { NativeRequest } from "../api";
import { Action, usePalette } from "../ui";
import { IntegrationsScreen } from "../integrations/IntegrationsScreen";
import { NativePushSettings } from "../notifications/NativePush";
import { ComposerToolbar } from "./ComposerToolbar";
import { AttachmentFields, useAttachmentPicker } from "./Attachments";
import { ChatHeader } from "./ChatHeader";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { PhotoDirectory } from "../../../src/contracts/identity-photos";
import { AssistantEditor } from "../AccountSettings";
import { sizeLimit, workspacePath } from "./commands";
import { SketchPanel } from "./SketchPanel";
import { PendingStrip } from "./PendingStrip";
import { FilePanel, Panel, ReferencePanel, SharedFiles } from "./SharedFiles";
import { Consultation, EvidencePanel } from "./Consultation";
import type { ConsultationRef } from "../../../src/contracts/private-consultation";
import { MemberProfile } from "./MemberProfile";
import { CommandPalette } from "./CommandPalette";
import {
  analysisDraft,
  launcherQuery,
  type ComposerActionId,
} from "../../../src/shared/composer-actions";
import { Timeline } from "./Timeline";
import { useTopicReading, type ChatTopic } from "./useTopicReading";
import { useComposerDraft } from "./useComposerDraft";
import { useCommands } from "./useCommands";
import { useWorkspace } from "./useWorkspace";
import {
  mentionAtCaret,
  insertMention,
  resolveMentionIds,
} from "../../../src/shared/conversation-mentions";
import { WorkspaceTools, type Tool } from "./WorkspaceTools";
import type { AssistantSettings } from "../../../src/contracts/assistant-settings";
import { CallScreen } from "../calls/CallScreen";
import { VoicePanel } from "./VoicePanel";

type Props = {
  origin: string;
  actorId: string;
  email: string;
  workspaceId: string;
  name: string;
  request: NativeRequest;
  onBack: () => void;
  onOpenNavigation?: () => void;
  registerWorkspaceTools?: (open: ((section: string) => void) | null) => void;
  incomingInvitations?: React.ReactNode;
  openWorkspace: (id: string, name: string) => void;
  initialMessageId?: string;
};
type Tab =
  | "Chat"
  | "Condivisi"
  | "Strumenti"
  | "email"
  | "calendar"
  | "call"
  | "assistant";
export function WorkspaceScreen(props: Props) {
  return (
    <WorkspaceContent
      key={JSON.stringify([props.origin, props.actorId, props.workspaceId])}
      {...props}
    />
  );
}
function WorkspaceContent({
  origin,
  actorId,
  email,
  workspaceId,
  name,
  request,
  onBack,
  openWorkspace,
  onOpenNavigation,
  registerWorkspaceTools,
  incomingInvitations,
  initialMessageId,
}: Props) {
  const { locale, t: uiText } = useUiLanguage();
  const p = usePalette();
  const path = workspacePath(workspaceId);
  const scope = useMemo(
    () => ({ origin, actorId, workspaceId }),
    [origin, actorId, workspaceId],
  );
  const { snapshot, error, busy, refresh } = useWorkspace(request, workspaceId);
  const photos = useResource<PhotoDirectory>(
    request,
    "/api/v1/identity-photos?workspace=" +
      encodeURIComponent(workspaceId) +
      "&v=" +
      (snapshot?.workspace.photo_revision ?? 0),
  );
  const [voiceId, setVoiceId] = useState<string>();
  const voiceIndex = useResource<z.infer<typeof voiceMessagesSchema>>(
    request,
    path + "/voice",
  );
  // The source list changes when a voice message is shared, removed or transcribed.
  const lastSource = snapshot?.sources.at(-1)?.id;
  const refreshVoiceIndex = voiceIndex.refresh;
  useEffect(() => {
    if (lastSource) refreshVoiceIndex();
  }, [lastSource, refreshVoiceIndex]);
  const voiceIds = useMemo(
    () => new Set(voiceIndex.value?.messages.map((m) => m.messageId)),
    [voiceIndex.value],
  );
  const [tab, setTab] = useState<Tab>("Chat");
  const [lens, setLens] = useState<"drawer" | "docked" | "wide">("drawer");
  const [stageWidth, setStageWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const { height, width } = useWindowDimensions();
  const compactWriting =
    tab === "Chat" && editing && width > height && height < 480;
  const [tool, setTool] = useState<{
    name: Tool;
    item?: string;
    createTask?: boolean;
  }>();
  const [fromIndex, setFromIndex] = useState(false);
  const [fromShared, setFromShared] = useState(false);
  function openShared(fromToolIndex = false) {
    setFromIndex(fromToolIndex);
    setFromShared(false);
    setTab("Condivisi");
  }
  function openSharedDocuments(item?: string) {
    openTool("Documenti di lavoro", item);
    setFromShared(true);
  }
  function backToIndex() {
    setTool(undefined);
    setFromShared(false);
    setTab("Strumenti");
  }
  function openTool(name: Tool, item?: string) {
    setFromShared(false);
    if (name === "Invita una persona") setLens("drawer");
    setTool({ name, item });
    setTab("Strumenti");
  }
  useEffect(() => {
    if (!registerWorkspaceTools) return;
    registerWorkspaceTools((section) => {
      setExtra(null);
      if (section === "Chat" || section === "Condivisi") {
        if (section === "Condivisi") openShared();
        else setTab("Chat");
        return;
      }
      if (section === "Email" || section === "Calendario") {
        setTab(section === "Email" ? "email" : "calendar");
        return;
      }
      if (section === "Configura Emme") {
        setTab("assistant");
        return;
      }
      const routes: Readonly<Record<string, Tool>> = {
        "Attività e argomenti": "Attività e argomenti",
        Direzione: "Direzione",
        "In programma": "In programma",
        Contesto: "Contesto",
        "Persone e accesso": "Persone",
        "Fonti e ricerca": "Ricerca web",
        "Guida e comandi": "Guida e comandi",
        Notifiche: "Notifiche",
        "Feedback beta": "Feedback beta",
        "Documenti di lavoro": "Documenti di lavoro",
      };
      if (routes[section]) openTool(routes[section]);
    });
    return () => registerWorkspaceTools(null);
  }, [registerWorkspaceTools]);
  const [focus, setFocus] = useState<ChatTopic | null>(null);
  const reading = useTopicReading(
    request,
    path,
    focus,
    snapshot?.messages.at(-1)?.sequence ?? 0,
    snapshot?.workspace.revision ?? 0,
  );
  const focusedSnapshot = useMemo(
    () =>
      snapshot && focus
        ? {
            ...snapshot,
            joins: [],
            reading: undefined,
            messages: reading.page?.messages ?? [],
          }
        : snapshot,
    [snapshot, focus, reading.page?.messages],
  );
  const topic = reading.page?.topic;
  const topicWritable =
    !focus ||
    Boolean(topic?.state === "active" && topic.version === focus.version);
  const draft = useComposerDraft(scope);
  const { text, files, ask, quoteId } = draft.value;
  const authored = !!(text || files.length || quoteId);
  const sourceTopic = draft.value.topic;
  const draftMatches =
    !authored ||
    (sourceTopic?.id === focus?.id && sourceTopic?.version === focus?.version);
  const editDraft = (change: Parameters<typeof draft.edit>[0]) =>
    draft.edit({
      ...change,
      topic: authored
        ? sourceTopic
        : focus
          ? { id: focus.id, version: focus.version, title: focus.title }
          : undefined,
    });
  const [caret, setCaret] = useState<number | null>(null);
  const mentions = useMemo(
    () =>
      (snapshot?.members ?? [])
        .filter((m) => m.active && m.user_id !== actorId)
        .map((m) => ({ id: m.user_id, name: m.name })),
    [snapshot?.members, actorId],
  );
  const match = caret === null ? null : mentionAtCaret(text, caret);
  const choices = match
    ? mentions
        .filter(
          (m) =>
            m.name.toLocaleLowerCase("it-IT") !== "emme" &&
            m.name
              .toLocaleLowerCase("it-IT")
              .startsWith(match.query.toLocaleLowerCase("it-IT")),
        )
        .slice(0, 8)
    : [];
  const chosen = draft.value.mentionIds ?? [];
  const quote =
    snapshot?.messages.find((m) => m.id === quoteId) ??
    reading.page?.messages.find((m) => m.id === quoteId);
  const feedback = feedbackFromComposer(text);
  const [extra, setExtra] = useState<
    null | "allega" | "voce" | "azioni" | "sketch"
  >(null);
  const [actionQuery, setActionQuery] = useState<string | null>(null);
  const [person, setPerson] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [details, setDetails] = useState<ConversationReference | null>(null);
  const [recap, setRecap] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<ConsultationRef | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [jump, setJump] = useState(initialMessageId);
  const [timelineKey, setTimelineKey] = useState(0);
  const [toolsKey, setToolsKey] = useState(0);
  const input = useRef<TextInput>(null);
  const resumeTyping = useRef(false);
  const commands = useCommands(request, scope, (pending) => {
    draft.settled(pending.intent.draftToken);
    if (
      pending.intent.kind === "command" &&
      pending.intent.command.type === "member.leave"
    ) {
      onBack();
      return;
    }
    if (
      pending.intent.kind === "command" &&
      pending.intent.command.type === "message.send"
    ) {
      setExtra(null);
    }
    refresh();
    setToolsKey((i) => i + 1);
  });
  const member = snapshot?.members.find((m) => m.user_id === actorId);
  const contribute = !!member?.active && member.contributes;
  const settings = useResource<AssistantSettings>(
    request,
    "/api/v1/assistant-settings?workspaceId=" +
      encodeURIComponent(workspaceId) +
      "&rev=" +
      (snapshot?.workspace.assistant_settings_revision ?? 0),
  );
  const assistant = settings.value?.displayName ?? "Emme";
  const disabled =
    !draft.ready ||
    !commands.ready ||
    !!commands.pending ||
    commands.working ||
    !contribute;
  const pickerProps = {
    files,
    onChange: (items: typeof files) => {
      void draft.editFiles({
        files: items,
        topic: authored ? sourceTopic : (focus ?? undefined),
      });
    },
    disabled,
  };
  const picker = useAttachmentPicker(pickerProps);
  const canInvite = !!snapshot?.access.some(
    (a) => a.active && a.holder_id === actorId && a.invitations,
  );
  function paletteAction(id: ComposerActionId) {
    setExtra(null);
    if (id === "sketch") {
      Keyboard.dismiss();
      setExtra("sketch");
      return;
    }
    if (id === "ask-emme" || id === "analyze") {
      editDraft({
        ask: true,
        ...(id === "analyze" ? { text: analysisDraft(text, locale) } : {}),
      });
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    if (id === "upload" || id === "research") {
      openTool("Ricerca web", id === "upload" ? "carica" : "ricerca");
      return;
    }
    if (id === "documents") {
      openShared();
      return;
    }
    if (id === "email" || id === "calendar") {
      setTab(id);
      return;
    }
    if (id === "new-task") {
      setFromShared(false);
      setTool({ name: "In programma", createTask: true });
      setTab("Strumenti");
      return;
    }
    if (id === "guide") {
      openTool("Guida e comandi");
      return;
    }
    const destination: Record<typeof id, Tool> = {
      work: "In programma",
      context: "Contesto",
      goal: "Direzione",
      questions: "Domande",
      activity: "Argomenti",
      invite: "Invita una persona",
      people: "Persone",
      notifications: "Notifiche",
      feedback: "Feedback beta",
    };
    openTool(destination[id]);
  }
  const send = (explicit: boolean) => {
    const value = text.trim();
    if (
      disabled ||
      !draftMatches ||
      !topicWritable ||
      (quoteId && !quote) ||
      (!value && !files.length) ||
      (explicit && !value)
    )
      return;
    if (feedback !== null) {
      if (files.length || !feedback || feedback.length > 6000) {
        Alert.alert(
          uiText("Feedback beta"),
          files.length
            ? uiText("Rimuovi gli allegati prima di salvare il feedback.")
            : uiText("Scrivi una nota tra 1 e 6.000 caratteri dopo /feedback."),
        );
        return;
      }
      void draft.submit(commands.send, {
        kind: "command",
        label: "Feedback beta",
        command: { type: "beta.feedback.add", content: feedback },
      });
      return;
    }
    const content = explicit ? addressMiriam(value) : value;
    if (content.length > 12000) return;
    void draft.submit(commands.send, {
      kind: "command",
      label: explicit ? "Domanda a " + assistant : "Messaggio al gruppo",
      files,
      command: {
        type: "message.send",
        ...(focus
          ? {
              workstreamFocus: {
                workstreamId: focus.id,
                version: focus.version,
              },
            }
          : {}),
        content,
        ...(chosen.length
          ? {
              mentionIds: resolveMentionIds(content, mentions, chosen).filter(
                (id) => chosen.includes(id),
              ),
            }
          : {}),
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(quote
          ? {
              quoteMessageId: quote.id,
              ...(quote.actor_kind === "human"
                ? {
                    reference: {
                      kind: "source" as const,
                      id: quote.id,
                      version: 1,
                    },
                  }
                : {}),
            }
          : {}),
      },
    });
  };
  const goTo = (id: string) => {
    setFocus(null);
    setRecap(null);
    setEvidence(null);
    setDetails(null);
    setFileId(null);
    setExtra(null);
    setTab("Chat");
    setJump(id);
    setTimelineKey((k) => k + 1);
  };
  function consultReference(r: ConsultationRef) {
    if (r.kind === "source" && snapshot?.messages.some((m) => m.id === r.id)) {
      goTo(r.id);
      return;
    }
    const parsed = conversationReferenceSchema.safeParse({
      kind: r.kind,
      id: r.id,
      version: r.version,
    });
    setRecap(null);
    if (parsed.success) setDetails(parsed.data);
    else setEvidence(r);
  }
  const selected = snapshot?.sources.find(
    (f) => (!f.withdrawn || f.can_manage_visibility) && f.id === fileId,
  );
  useEffect(() => {
    if (tab !== "Condivisi") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (fromIndex) backToIndex();
      else setTab("Chat");
      return true;
    });
    return () => sub.remove();
  }, [tab, fromIndex]);
  const fullScreen = tab === "assistant" || tab === "call";
  const panelOpen =
    tab === "Condivisi" ||
    tab === "Strumenti" ||
    tab === "email" ||
    tab === "calendar";
  const desktop = width > 760 && height > 480;
  const canDock = desktop && stageWidth >= 720;
  const docked =
    panelOpen &&
    canDock &&
    lens === "docked" &&
    !(tab === "Strumenti" && tool?.name === "Invita una persona");
  const overlay = panelOpen && desktop && !docked;
  const chatVisible = !fullScreen && (tab === "Chat" || docked);
  const panelWidth = Math.min(470, Math.max(346, stageWidth * 0.47));
  function timeline(data: Snapshot, filtered = false) {
    return (
      <Timeline
        photos={photos.value}
        visible={chatVisible && (filtered || !focus)}
        assistantName={assistant}
        origin={origin}
        refresh={refresh}
        key={filtered ? "topic:" + focus?.id : timelineKey}
        snapshot={data}
        allMessages={snapshot?.messages}
        onOriginal={goTo}
        request={request}
        path={path}
        actorId={actorId}
        initialMessageId={filtered ? undefined : jump}
        voiceIds={voiceIds}
        onVoice={(id) => {
          setVoiceId(id);
          setExtra("voce");
        }}
        onRecap={setRecap}
        onPerson={(id, name) => setPerson({ id, name })}
        commands={commands}
        canWrite={contribute}
        online={!error}
        onTool={openTool}
        onConsultReference={consultReference}
        onIntegration={setTab}
        onRef={setDetails}
        onFile={(f) => setFileId(f.id)}
        onQuote={(m, a) => {
          editDraft({
            quoteId: m.id,
            ask: a,
            ...(a && !text.trim() ? { text: defaultQuotedQuestion } : {}),
          });
          input.current?.focus();
        }}
      />
    );
  }
  const layoutActions =
    desktop && !(tab === "Strumenti" && tool?.name === "Invita una persona") ? (
      <View
        style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}
      >
        {canDock && (
          <Action
            variant="quiet"
            label={docked ? uiText("Sgancia") : uiText("Affianca")}
            onPress={() => setLens(docked ? "drawer" : "docked")}
          />
        )}
        <Action
          variant="quiet"
          label={lens === "wide" ? uiText("Riduci") : uiText("Allarga")}
          onPress={() => setLens(lens === "wide" ? "drawer" : "wide")}
        />
      </View>
    ) : undefined;
  return (
    <>
      <View
        style={{ flex: 1, display: fullScreen ? "none" : "flex" }}
        accessibilityElementsHidden={fullScreen}
        importantForAccessibility={fullScreen ? "no-hide-descendants" : "auto"}
      >
        <ChatViewport backgroundColor={p.bg}>
          {!compactWriting && (
            <ChatHeader
              photos={photos.value}
              name={name}
              snapshot={snapshot ?? undefined}
              request={request}
              path={path}
              assistant={settings.value}
              shared={tab === "Condivisi"}
              canInvite={canInvite && !panelOpen}
              openNavigation={onOpenNavigation}
              showChat={() => {
                setExtra(null);
                setTab("Chat");
              }}
              showShared={() => {
                setExtra(null);
                if (width >= 1152) setLens("docked");
                openShared();
              }}
              onTool={openTool}
            />
          )}
          {!compactWriting && !panelOpen && incomingInvitations}
          {!!error && (
            <View style={{ padding: 8, gap: 4 }}>
              <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
                {error}
              </Text>
              <Action label={uiText("Aggiorna")} onPress={refresh} />
            </View>
          )}
          {!snapshot && busy && (
            <Text style={{ color: p.muted, padding: 16 }}>
              {uiText("Apertura dello spazio…")}
            </Text>
          )}
          {draft.error && (
            <Text accessibilityRole="alert" style={{ color: p.text }}>
              {draft.error}
            </Text>
          )}
          <PendingStrip commands={commands} />
          {snapshot && (
            <>
              <View
                onLayout={(e) => setStageWidth(e.nativeEvent.layout.width)}
                style={{ flex: 1, flexDirection: "row" }}
              >
                <View
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: chatVisible || overlay ? "flex" : "none",
                  }}
                  accessibilityElementsHidden={!chatVisible}
                  importantForAccessibility={
                    chatVisible ? "auto" : "no-hide-descendants"
                  }
                >
                  {focus && (
                    <View
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 4,
                        borderBottomWidth: 1,
                        borderColor: p.line,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Text
                          numberOfLines={2}
                          style={{
                            flex: 1,
                            color: p.heading,
                            fontWeight: "600",
                          }}
                        >
                          {focus.title}
                        </Text>
                        <Action
                          variant="quiet"
                          label={uiText("Tutta la conversazione")}
                          onPress={() => setFocus(null)}
                        />
                      </View>
                      {reading.loading && (
                        <Text style={{ color: p.muted }}>
                          {uiText("Apertura dell’argomento…")}
                        </Text>
                      )}
                      {!!reading.error && (
                        <Action
                          label={uiText("{0} · Riprova", String(reading.error))}
                          onPress={reading.refresh}
                        />
                      )}
                      {reading.page && !topicWritable && (
                        <Text style={{ color: p.muted }}>
                          {uiText("L’argomento è cambiato o non è attivo.")}
                        </Text>
                      )}
                      {topic?.state === "active" &&
                        focus.version !== topic.version && (
                          <Action
                            label={uiText("Aggiorna la vista")}
                            onPress={() => setFocus(topic)}
                          />
                        )}
                      {reading.page?.more && (
                        <Action
                          variant="quiet"
                          label={uiText("Messaggi precedenti")}
                          onPress={reading.older}
                        />
                      )}
                      {reading.historical && (
                        <Action
                          variant="quiet"
                          label={uiText("Torna ai messaggi recenti")}
                          onPress={reading.recent}
                        />
                      )}
                    </View>
                  )}
                  <View
                    style={{ flex: 1, display: focus ? "none" : "flex" }}
                    accessibilityElementsHidden={!!focus}
                    importantForAccessibility={
                      focus ? "no-hide-descendants" : "auto"
                    }
                  >
                    {timeline(snapshot)}
                  </View>
                  {focus && focusedSnapshot && timeline(focusedSnapshot, true)}

                  {contribute ? (
                    <View
                      style={{
                        marginHorizontal: width < 640 ? 14 : 26,
                        marginBottom: compactWriting ? 1 : 8,
                        marginTop: 4,
                        paddingHorizontal: width < 360 ? 4 : 8,
                        paddingVertical: editing ? 4 : 0,
                        borderWidth: 1,
                        borderColor: editing ? p.controlLine : p.line,
                        backgroundColor: p.field,
                        borderRadius: 16,
                        gap: editing ? 2 : 0,
                      }}
                    >
                      {!draftMatches && (
                        <View>
                          <Text style={{ color: p.muted }}>
                            {uiText("Questa bozza è stata scritta in")}{" "}
                            {sourceTopic?.title ??
                              uiText("Tutta la conversazione")}
                            .
                          </Text>
                          <Action
                            variant="quiet"
                            label={uiText("Usa la bozza in questa vista")}
                            onPress={() =>
                              draft.edit({
                                topic: focus
                                  ? {
                                      id: focus.id,
                                      version: focus.version,
                                      title: focus.title,
                                    }
                                  : undefined,
                              })
                            }
                          />
                        </View>
                      )}
                      {!!quoteId && !quote && (
                        <Action
                          label={uiText("Citazione non disponibile · Rimuovi")}
                          onPress={() => editDraft({ quoteId: undefined })}
                        />
                      )}
                      {!!quote && (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Text
                            numberOfLines={2}
                            style={{ flex: 1, color: p.muted }}
                          >
                            ↳ {quote.author_name} · {quote.content}
                          </Text>
                          <Action
                            label={uiText("Togli citazione")}
                            onPress={() => editDraft({ quoteId: undefined })}
                          />
                        </View>
                      )}
                      {files.length > 0 && (
                        <Action
                          label={uiText(
                            "{0} allegati in bozza",
                            String(files.length),
                          )}
                          onPress={() => setExtra("allega")}
                        />
                      )}
                      {!!choices.length && (
                        <View style={{ maxHeight: 102 }}>
                          <ScrollView keyboardShouldPersistTaps="always">
                            {choices.map((m) => (
                              <Action
                                key={m.id}
                                label={"@" + m.name}
                                onPress={() => {
                                  if (caret === null) return;
                                  const inserted = insertMention(
                                    text,
                                    caret,
                                    m.name,
                                  );
                                  if (!inserted) return;
                                  editDraft({
                                    text: inserted.text,
                                    mentionIds: [...new Set([...chosen, m.id])],
                                  });
                                  setCaret(null);
                                  input.current?.focus();
                                  requestAnimationFrame(() =>
                                    input.current?.setSelection(
                                      inserted.caret,
                                      inserted.caret,
                                    ),
                                  );
                                }}
                              />
                            ))}
                          </ScrollView>
                        </View>
                      )}
                      {Boolean(picker.error) && (
                        <Text
                          accessibilityRole="alert"
                          style={{ color: p.danger }}
                        >
                          {picker.error}
                        </Text>
                      )}
                      <TextInput
                        disableFullscreenUI
                        ref={input}
                        onFocus={() => setEditing(true)}
                        onBlur={() => setEditing(false)}
                        editable={!disabled && topicWritable}
                        multiline
                        value={text}
                        onSelectionChange={(event) =>
                          setCaret(event.nativeEvent.selection.end)
                        }
                        onChangeText={(next) => {
                          const query = launcherQuery(text, next);
                          if (query !== null) {
                            setActionQuery(query);
                            setExtra("azioni");
                            Keyboard.dismiss();
                            return;
                          }
                          const present = resolveMentionIds(
                            next,
                            mentions,
                            chosen,
                          );
                          editDraft({
                            text: next,
                            mentionIds: chosen.filter((id) =>
                              present.includes(id),
                            ),
                          });
                        }}
                        maxLength={ask ? 11990 : 12000}
                        accessibilityLabel={
                          ask
                            ? uiText("Chiedi a {0}", String(assistant))
                            : uiText("Messaggio al gruppo")
                        }
                        placeholder={
                          ask
                            ? uiText("Chiedi a {0}…", String(assistant))
                            : uiText(
                                "Scrivi al gruppo o chiedi a {0}…",
                                String(assistant),
                              )
                        }
                        placeholderTextColor={p.muted}
                        style={{
                          borderRadius: 12,
                          backgroundColor: "transparent",
                          paddingHorizontal: 5,
                          paddingVertical: 9,
                          fontSize: 17,
                          color: p.text,
                          minHeight: 44,
                          maxHeight: compactWriting ? 60 : 120,
                        }}
                      />
                      {(editing || width >= 761) && (
                        <ComposerToolbar
                          dismissKeyboard={
                            compactWriting ? Keyboard.dismiss : undefined
                          }
                          disabled={disabled || picker.picking}
                          canSend={
                            draftMatches &&
                            topicWritable &&
                            (!quoteId || !!quote) &&
                            (text.trim().length > 0 ||
                              (!ask && files.length > 0))
                          }
                          ask={ask}
                          assistant={assistant}
                          feedback={feedback !== null}
                          attach={() => void picker.pick(false)}
                          camera={() => void picker.pick(true)}
                          voice={() => {
                            Keyboard.dismiss();
                            setVoiceId(undefined);
                            setExtra("voce");
                          }}
                          call={() => {
                            Keyboard.dismiss();
                            setTab("call");
                          }}
                          actions={() => {
                            Keyboard.dismiss();
                            setActionQuery(null);
                            setExtra("azioni");
                          }}
                          send={() => send(ask)}
                          askAssistant={() => {
                            if (!ask && text.trim()) {
                              send(true);
                              return;
                            }
                            editDraft({ ask: !ask });
                            input.current?.focus();
                          }}
                        />
                      )}
                    </View>
                  ) : (
                    <Text style={{ color: p.muted, padding: 12 }}>
                      {uiText("Puoi leggere la conversazione.")}
                    </Text>
                  )}
                </View>
                {overlay && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={uiText("Chiudi pannello")}
                    onPress={() => setTab("Chat")}
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: "#10151458" },
                    ]}
                  />
                )}
                {panelOpen && (
                  <View
                    style={[
                      !desktop
                        ? { flex: 1 }
                        : docked
                          ? {
                              width: panelWidth,
                              borderLeftWidth: 1,
                              borderColor: p.line,
                            }
                          : {
                              position: "absolute",
                              top: 8,
                              bottom: 8,
                              right: 8,
                              width:
                                lens === "wide"
                                  ? Math.max(250, stageWidth - 16)
                                  : Math.min(
                                      (stageWidth || width) - 16,
                                      panelWidth,
                                    ),
                              borderWidth: 1,
                              borderColor: p.line,
                              borderRadius: 12,
                              overflow: "hidden",
                            },
                      { backgroundColor: p.bg },
                    ]}
                  >
                    {(tab === "Condivisi" ||
                      (tab === "Strumenti" && fromShared)) && (
                      <View
                        style={{
                          flex: 1,
                          display: tab === "Condivisi" ? "flex" : "none",
                        }}
                        accessibilityElementsHidden={tab !== "Condivisi"}
                        importantForAccessibility={
                          tab !== "Condivisi" ? "no-hide-descendants" : "auto"
                        }
                      >
                        <SharedFiles
                          headerActions={layoutActions}
                          onClose={() => setTab("Chat")}
                          identity={{ actorId, origin }}
                          onBack={fromIndex ? backToIndex : undefined}
                          onNewDocument={() => openSharedDocuments("new")}
                          onDocuments={() => openSharedDocuments()}
                          commands={commands}
                          onMessage={goTo}
                          request={request}
                          snapshot={snapshot}
                          open={(f) => setFileId(f.id)}
                          onAttach={
                            contribute
                              ? () => {
                                  setTab("Chat");
                                  setExtra("allega");
                                }
                              : undefined
                          }
                        />
                      </View>
                    )}
                    {tab === "Strumenti" && (
                      <WorkspaceTools
                        onOpenTopic={(topic) => {
                          reading.recent();
                          setFocus(topic);
                          setTab("Chat");
                        }}
                        headerActions={layoutActions}
                        key={[tool?.name, tool?.item].join(":")}
                        onClose={() => setTab("Chat")}
                        photos={photos.value}
                        onPerson={(id, name) => setPerson({ id, name })}
                        onShared={() => openShared(true)}
                        onParent={
                          fromShared
                            ? {
                                label: uiText("Torna al raccoglitore"),
                                open: () => setTab("Condivisi"),
                              }
                            : undefined
                        }
                        onFile={setFileId}
                        prepareTask={tool?.createTask}
                        initialSection={tool?.name}
                        itemId={tool?.item}
                        openWorkspace={openWorkspace}
                        refreshKey={toolsKey}
                        request={request}
                        path={path}
                        actorId={actorId}
                        snapshot={snapshot}
                        commands={commands}
                        onRef={setDetails}
                        onIntegration={(t) => {
                          if (!commands.pending) setTab(t);
                        }}
                        onMessage={goTo}
                        onConsultReference={consultReference}
                      >
                        <NativePushSettings
                          request={request}
                          origin={origin}
                          workspaceId={workspaceId}
                        />
                      </WorkspaceTools>
                    )}
                    {(tab === "email" || tab === "calendar") && snapshot && (
                      <IntegrationsScreen
                        headerActions={layoutActions}
                        kind={tab}
                        request={request}
                        origin={origin}
                        actorId={actorId}
                        email={email}
                        canContribute={contribute}
                        personal={snapshot.workspace.personal}
                        workspaceId={workspaceId}
                        name={name}
                        onBack={() => {
                          setTab("Chat");
                          refresh();
                        }}
                      />
                    )}
                  </View>
                )}
              </View>
              {recap && (
                <Panel
                  title={uiText("Riassumi da qui")}
                  onClose={() => setRecap(null)}
                >
                  <ScrollView contentContainerStyle={{ gap: 8 }}>
                    <Consultation
                      request={request}
                      path={path}
                      actorId={actorId}
                      anchor={recap}
                      canShare={contribute}
                      onReference={consultReference}
                      onMessage={goTo}
                    />
                  </ScrollView>
                </Panel>
              )}
              {evidence && (
                <EvidencePanel
                  key={evidence.kind + evidence.id}
                  entry={evidence}
                  path={path}
                  request={request}
                  snapshot={snapshot}
                  onClose={() => setEvidence(null)}
                  onSource={(id) => {
                    setEvidence(null);
                    consultReference({
                      kind: "source",
                      id,
                      version: 1,
                      label: "Fonte",
                    });
                  }}
                />
              )}
              {person && (
                <MemberProfile
                  workspaceId={workspaceId}
                  request={request}
                  personId={person.id}
                  name={person.name}
                  onClose={() => setPerson(null)}
                />
              )}
              {selected && (
                <FilePanel
                  canWrite={contribute}
                  file={selected}
                  workspaceId={workspaceId}
                  request={request}
                  commands={commands}
                  onClose={() => setFileId(null)}
                  onMessage={goTo}
                />
              )}
              {details && (
                <ReferencePanel
                  key={JSON.stringify(details)}
                  refValue={details}
                  request={request}
                  path={path}
                  snapshot={snapshot}
                  onClose={() => setDetails(null)}
                  onMessage={goTo}
                />
              )}
              <Panel
                title={uiText("Allega al messaggio")}
                visible={extra === "allega"}
                onClose={() => setExtra(null)}
                onDismiss={() => {
                  if (resumeTyping.current) {
                    resumeTyping.current = false;
                    input.current?.focus();
                  }
                }}
              >
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ gap: 12 }}
                >
                  <AttachmentFields {...pickerProps} picker={picker} />
                  <Action
                    label={uiText("Torna al messaggio")}
                    onPress={() => {
                      setExtra(null);
                      if (Platform.OS === "ios") resumeTyping.current = true;
                      else requestAnimationFrame(() => input.current?.focus());
                    }}
                  />
                </ScrollView>
              </Panel>
              {extra === "sketch" && (
                <SketchPanel
                  onClose={() => setExtra(null)}
                  onAttach={async (file) => {
                    if (
                      disabled ||
                      files.length >= 10 ||
                      files.reduce((total, f) => total + f.size, file.size) >
                        sizeLimit
                    )
                      return false;
                    const saved = await draft.editFiles({
                      files: [...files, file],
                      topic: authored ? sourceTopic : (focus ?? undefined),
                    });
                    if (!saved)
                      throw new Error(
                        uiText(
                          "Impossibile salvare il disegno sul dispositivo. Riprova.",
                        ),
                      );
                    return true;
                  }}
                />
              )}
              {extra === "voce" && (
                <VoicePanel
                  messages={snapshot.messages}
                  request={request}
                  path={path}
                  commands={commands}
                  messageId={voiceId}
                  canContribute={contribute}
                  onClose={() => {
                    setExtra(null);
                    setVoiceId(undefined);
                  }}
                />
              )}
              {extra === "azioni" && (
                <CommandPalette
                  assistantName={assistant}
                  initial={actionQuery}
                  permissions={{
                    canContribute: contribute,
                    canInvite: snapshot.access.some(
                      (r) =>
                        r.active && r.holder_id === actorId && r.invitations,
                    ),
                  }}
                  choose={paletteAction}
                  onClose={() => setExtra(null)}
                  write={(text) => {
                    editDraft({ text });
                    setExtra(null);
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                />
              )}
            </>
          )}
        </ChatViewport>
      </View>
      {tab === "assistant" && snapshot && (
        <AssistantEditor
          request={request}
          actorId={actorId}
          initialWorkspaceId={workspaceId}
          initialWorkspaceName={snapshot.workspace.name ?? name}
          backLabel={uiText("Chiudi")}
          onBack={() => {
            setTab("Chat");
            settings.refresh();
          }}
        />
      )}
      {tab === "call" && snapshot && (
        <CallScreen
          request={request}
          actorId={actorId}
          origin={origin}
          workspaceId={workspaceId}
          name={name}
          canContribute={contribute}
          onBack={() => setTab("Chat")}
        />
      )}
    </>
  );
}
