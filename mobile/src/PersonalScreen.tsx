import { useUiLanguage } from "./i18n";
import { useKeyboardVisible } from "./useKeyboardVisible";
import { ChatViewport } from "./ChatViewport";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  ScrollView,
  Switch,
  Text,
  TextInput,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import * as Crypto from "expo-crypto";
import type { HomeProps } from "./AppHome";
import { HomeControl } from "./AppShell";
import type {
  ChatDirectory,
  ChatState,
  PersonalChatInput,
} from "../../src/contracts/personal-chats";
import type { PrivateConsultation } from "../../src/contracts/private-consultation";
import { addressMiriam } from "../../src/shared/miriam-address";
import { assistantRequestFailures } from "../../src/shared/assistant-request-failures";
import { AssistantFailureNotice } from "./workspace/AssistantFailureNotice";
import { SourceUpload } from "./workspace/SourceUpload";
import { NativePushSettings } from "./notifications/NativePush";
import { AttachmentPreview } from "./AttachmentPreview";
import { StudioIcon, type StudioIconName } from "./StudioIcon";
import { ConsultedSource } from "./personal/ConsultedSource";
import type { ConsultationRef } from "../../src/contracts/private-consultation";
import { PersonalFiles, PersonalReminders } from "./personal/PersonalArchive";
import { AssistantEditor } from "./AccountSettings";
import { Action, Field, usePalette } from "./ui";
import { post, type NativeRequest } from "./api";
import { useResource } from "./useResource";
import { useWorkspace } from "./workspace/useWorkspace";
import { useComposerDraft } from "./workspace/useComposerDraft";
import { useCommands, describe } from "./workspace/useCommands";
import { PendingStrip } from "./workspace/PendingStrip";
import { Panel } from "./workspace/SharedFiles";
import { workspacePath } from "./workspace/commands";

const endpoint = "/api/v1/personal-chats";
type Tab = "chat" | "documents" | "reminders";
const tabs: readonly [Tab, string, StudioIconName][] = [
  ["chat", "Tu ed Emme", "chat"],
  ["documents", "Documenti", "files"],
  ["reminders", "Promemoria", "bell"],
];
type Props = HomeProps & {
  onOpenNavigation?: () => void;
  onBack: () => void;
  start?: Tab | "assistant";
  initialThreadId?: string;
};
export function PersonalScreen(props: Props) {
  const { t: uiText } = useUiLanguage();
  const { user, request, onBack, start, initialThreadId } = props;
  const [tab, setTab] = useState<Tab>(
    start === "assistant" ? "chat" : (start ?? "chat"),
  );
  const [notifications, setNotifications] = useState(false);
  const [configuring, configure] = useState(start === "assistant");
  const { width, height, fontScale } = useWindowDimensions();
  const narrow = width / fontScale < 450;
  const keyboardVisible = useKeyboardVisible();
  const writing = keyboardVisible && tab === "chat" && !configuring;
  const compactWriting =
    writing && width > 520 && height < 540 && width > height;
  const p = usePalette();
  const [thread, setThread] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [history, showHistory] = useState(false);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const nextId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (configuring) return;
    let active = true;
    const c = new AbortController();
    request<{ id: string }>(endpoint, {
      ...post({
        action: "open",
        expectedActorId: user.id,
        thread: initialThreadId,
      }),
      signal: c.signal,
    })
      .then((s) => {
        if (active) {
          setThread(s.id);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(describe(e));
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [request, user.id, retry, initialThreadId, configuring]);
  async function switchTo(fresh: boolean, id?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (fresh) nextId.current ??= Crypto.randomUUID();
      const input: PersonalChatInput = fresh
        ? { action: "new", thread: nextId.current!, expectedActorId: user.id }
        : { action: "open", thread: id, expectedActorId: user.id };
      const result = await request<{ id: string }>(endpoint, post(input));
      setThread(result.id);
      nextId.current = undefined;
      showHistory(false);
    } catch (e) {
      setError(describe(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (configuring)
    return (
      <AssistantEditor
        request={request}
        actorId={user.id}
        onBack={start === "assistant" ? onBack : () => configure(false)}
        backLabel={
          start === "assistant"
            ? uiText("Torna alla Home")
            : uiText("Area personale")
        }
      />
    );
  return (
    <ChatViewport backgroundColor={p.bg}>
      <View
        style={{
          display: compactWriting ? "none" : "flex",
          paddingHorizontal: 14,
          gap: 2,
          borderBottomWidth: 1,
          borderColor: p.line,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {props.onOpenNavigation && (
            <HomeControl
              label={uiText("Apri navigazione")}
              icon="menu"
              iconOnly
              onPress={props.onOpenNavigation}
            />
          )}
          <Text
            accessibilityRole="header"
            style={{
              color: p.heading,
              fontWeight: "700",
              fontSize: 23,
              flex: 1,
            }}
          >
            {uiText("Area personale")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText("Configura Emme")}
            onPress={() => configure(true)}
            style={{
              minWidth: 48,
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 6,
            }}
          >
            <StudioIcon name="settings" color={p.muted} />
            {!narrow && (
              <Text style={{ color: p.text }}>{uiText("Configura Emme")}</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText("Notifiche personali")}
            disabled={!thread}
            onPress={() => setNotifications(true)}
            style={{
              minHeight: 48,
              minWidth: 48,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <StudioIcon name="bell" color={p.muted} />
          </Pressable>
        </View>
        {!writing && (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 10 }}
          >
            {tabs.map(([key, title, icon]) => (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: key === tab }}
                onPress={() => setTab(key)}
                style={{
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  borderBottomWidth: 2,
                  borderColor: tab === key ? p.accent : "transparent",
                }}
              >
                <StudioIcon
                  name={icon}
                  size={17}
                  color={tab === key ? p.heading : p.muted}
                />
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: tab === key ? p.heading : p.muted,
                  }}
                >
                  {uiText(title)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
      {!!error && (
        <View style={{ padding: 12, gap: 5 }}>
          <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
            {error}
          </Text>
          {!thread && (
            <Action
              label={uiText("Riprova")}
              onPress={() => setRetry((v) => v + 1)}
            />
          )}
        </View>
      )}
      {!thread && !error && (
        <Text style={{ color: p.muted, padding: 14 }}>
          {uiText("Apertura della tua conversazione…")}
        </Text>
      )}
      {!!thread && (
        <PersonalThread
          key={thread}
          request={request}
          origin={props.origin}
          actorId={user.id}
          thread={thread}
          tab={tab}
          onTab={setTab}
          onHistory={() => showHistory(true)}
          onNew={() => void switchTo(true)}
          opening={busy}
          writing={writing}
          compactWriting={compactWriting}
        />
      )}
      {notifications && !!thread && (
        <Panel
          title={uiText("Notifiche personali")}
          onClose={() => setNotifications(false)}
        >
          <ScrollView>
            <NativePushSettings
              request={request}
              origin={props.origin}
              workspaceId={thread}
            />
          </ScrollView>
        </Panel>
      )}
      {history && (
        <Panel
          title={uiText("Le tue conversazioni")}
          onClose={() => showHistory(false)}
        >
          <Field
            label={uiText("Cerca una conversazione")}
            value={search}
            onChangeText={(s) => {
              setOffset(0);
              setSearch(s);
            }}
          />
          <History
            request={request}
            q={search}
            offset={offset}
            disabled={busy}
            pick={(id) => void switchTo(false, id)}
            more={() => setOffset((v) => v + 25)}
            reset={() => setOffset(0)}
          />
        </Panel>
      )}
    </ChatViewport>
  );
}
function History({
  request,
  q,
  offset,
  disabled,
  pick,
  more,
  reset,
}: {
  request: NativeRequest;
  q: string;
  offset: number;
  disabled: boolean;
  pick: (id: string) => void;
  more: () => void;
  reset: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const view = useResource<ChatDirectory>(
    request,
    endpoint + "?q=" + encodeURIComponent(q) + "&offset=" + offset,
  );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 8 }}
    >
      {view.error && <Text style={{ color: p.text }}>{view.error}</Text>}
      {view.value?.threads.map((t) => (
        <Action
          key={t.id}
          label={t.label + " · " + new Date(t.at).toLocaleDateString(locale)}
          disabled={disabled}
          onPress={() => pick(t.id)}
        />
      ))}
      {view.value?.threads.length === 0 && (
        <Text style={{ color: p.muted }}>
          {uiText("Nessuna conversazione trovata.")}
        </Text>
      )}
      {view.value?.more && (
        <Action label={uiText("Altre conversazioni")} onPress={more} />
      )}
      {!!offset && (
        <Action label={uiText("Torna all’inizio")} onPress={reset} />
      )}
    </ScrollView>
  );
}
type PersonalProps = {
  request: NativeRequest;
  actorId: string;
  origin: string;
  thread: string;
  tab: Tab;
  onTab: (next: Tab) => void;
  onHistory: () => void;
  onNew: () => void;
  opening: boolean;
  writing: boolean;
  compactWriting: boolean;
};
function PersonalThread({
  request,
  actorId,
  origin,
  thread,
  tab,
  onTab,
  onHistory,
  onNew,
  opening,
  writing,
  compactWriting,
}: PersonalProps) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const view = useWorkspace(request, thread);
  const failedRequests = useMemo(
    () =>
      view.snapshot &&
      assistantRequestFailures(
        view.snapshot.messages,
        view.snapshot.interpretations,
      ),
    [view.snapshot],
  );
  const canRetry =
    !view.error &&
    !!view.snapshot?.members.some(
      (member) =>
        member.user_id === actorId && member.active && member.contributes,
    );
  const state = useResource<ChatState>(
    request,
    endpoint + "?thread=" + thread,
    5500,
  );
  const scope = useMemo(
    () => ({ actorId, origin, workspaceId: thread }),
    [actorId, origin, thread],
  );
  const [tools, setTools] = useState<
    null | "target" | "research" | "document" | "actions" | "attach"
  >(null);
  const draft = useComposerDraft(scope);
  const { text } = draft.value;
  const [query, setQuery] = useState("");
  const [allow, setAllow] = useState(false);
  const [notify, setNotify] = useState(false);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const lock = useRef(false);
  const [result, setResult] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{
    turnId: string;
    target: string;
    ref: ConsultationRef;
  } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [doc, setDoc] = useState<PrivateConsultation | null>(null);
  const docRequest = useRef<
    { id: string; question: string; origin: string } | undefined
  >(undefined);
  const scroll = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const turnByMessage = new Map(
    state.value?.turns.map((t) => [t.messageId, t]),
  );
  const researchByMessage = new Map(
    state.value?.research.map((r) => [r.messageId, r]),
  );
  const current = state.value;
  const target = current?.selection;
  const chosen = current?.research.find((r) => r.id === result);
  const destination = current?.targets.find(
    (t) => t.contributes && t.id === dest,
  );
  const commands = useCommands(request, scope, (pending) => {
    draft.settled(pending.intent.draftToken);
    if (pending.intent.kind === "source") setTools(null);
    if (
      pending.intent.kind === "command" &&
      pending.intent.command.type === "research.private_request"
    ) {
      setTools(null);
      setQuery("");
      setNotify(false);
      setAllow(false);
    }
    state.refresh();
    view.refresh();
  });
  const disabled =
    !draft.ready ||
    !commands.ready ||
    commands.working ||
    !!commands.pending ||
    !current ||
    acting;
  async function act(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setActing(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(describe(e));
    } finally {
      lock.current = false;
      setActing(false);
      state.refresh();
    }
  }
  function select(id: string | null) {
    if (!target) return;
    void act(async () => {
      await request(
        endpoint,
        post({
          action: "select",
          expectedActorId: actorId,
          thread,
          target: id,
          expectedVersion: target.version,
        }),
      );
      setTools(null);
    });
  }
  function send() {
    if (!target || !text.trim() || disabled) return;
    const q = text.trim();
    const research = q.match(
      /^(?:@?emme[ ,:]*)?(?:(?:fai|avvia|prepara|fammi)\s+(?:una\s+)?)?ricerca approfondita(?:\s+(?:su|sul|sulla|riguardo a))?\s*[:,-]?\s*(.*)$/iu,
    );
    if (research) {
      setQuery(research[1]);
      setTools("research");
      setAllow(false);
      return;
    }
    atBottom.current = true;
    setError("");
    if (target.id) {
      void draft.submit(commands.send, {
        kind: "personalAsk",
        label: "Consultazione privata",
        target: target.id,
        selectionVersion: target.version,
        question: q,
      });
    } else
      void draft.submit(commands.send, {
        kind: "command",
        label: "Domanda personale",
        command: {
          type: "message.send",
          content: addressMiriam(q),
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
  }
  function prepareDocument() {
    if (!current || !query.trim()) return;
    const source = target?.id ?? thread;
    const question = query.trim();
    if (
      !docRequest.current ||
      docRequest.current.question !== question ||
      docRequest.current.origin !== source
    )
      docRequest.current = {
        id: Crypto.randomUUID(),
        question,
        origin: source,
      };
    const input = docRequest.current;
    void act(async () => {
      const result = await request<PrivateConsultation>(
        workspacePath(input.origin) + "/consultation",
        post({
          action: "document",
          kind: "document",
          expectedActorId: actorId,
          id: input.id,
          question: input.question,
        }),
      );
      docRequest.current = undefined;
      setDoc(result);
      setQuery("");
      view.refresh();
    });
  }
  function openResult(r: NonNullable<ChatState["research"]>[number]) {
    setResult(r.id);
    setDest(r.origin);
    if (r.status === "ready" && !r.read)
      void act(async () => {
        await request(
          endpoint,
          post({
            action: "research_read",
            thread,
            expectedActorId: actorId,
            workId: r.id,
          }),
        );
      });
  }
  if (!current || !view.snapshot)
    return (
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={{ color: p.text }}>
          {state.error || view.error || uiText("Apertura della conversazione…")}
        </Text>
        {(state.error || view.error) && (
          <Action
            label={uiText("Riprova")}
            onPress={() => {
              state.refresh();
              view.refresh();
            }}
          />
        )}
      </View>
    );
  if (tab === "reminders")
    return (
      <PersonalReminders
        key={current.archive}
        archive={current.archive}
        request={request}
        actorId={actorId}
        origin={origin}
      />
    );
  if (tab === "documents")
    return (
      <PersonalFiles
        key={current.archive}
        archive={current.archive}
        actorId={actorId}
        origin={origin}
        request={request}
        state={current}
        onClose={() => onTab("chat")}
      />
    );
  return (
    <View style={{ flex: 1 }}>
      {!writing && (
        <View
          style={{
            paddingHorizontal: 8,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            borderBottomWidth: 1,
            borderColor: p.line,
          }}
        >
          <Action
            variant="quiet"
            icon="history"
            label={uiText("Conversazioni")}
            onPress={onHistory}
          />
          <Action
            variant="quiet"
            icon="plus"
            label={uiText("Nuova conversazione")}
            onPress={onNew}
            disabled={opening}
          />
        </View>
      )}
      {tools === "actions" && (
        <Panel
          title={uiText("Azioni della chat personale")}
          onClose={() => setTools(null)}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 6 }}
          >
            <Action
              variant="quiet"
              icon="space"
              label={
                target?.id
                  ? uiText("Consulta · {0}", String(target.label))
                  : uiText("Consulta una conversazione")
              }
              onPress={() => setTools("target")}
              disabled={disabled}
            />
            <Action
              variant="quiet"
              icon="guide"
              label={uiText("Ricerca approfondita")}
              onPress={() => {
                setQuery("");
                setAllow(false);
                setTools("research");
              }}
              disabled={disabled}
            />
            <Action
              variant="quiet"
              icon="files"
              label={uiText("Prepara documento")}
              onPress={() => {
                setQuery("");
                setDoc(null);
                setTools("document");
              }}
              disabled={disabled}
            />
          </ScrollView>
        </Panel>
      )}
      {target?.id && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
          }}
        >
          <Text style={{ color: p.emme, flex: 1 }}>
            {uiText("Consultazione privata · ")}
            {target.label}
          </Text>
          <Action
            label={uiText("Termina")}
            disabled={disabled}
            onPress={() => select(null)}
          />
        </View>
      )}
      {!!(error || state.error || view.error) && (
        <View style={{ padding: 10, gap: 5 }}>
          <Text style={{ color: p.text }}>
            {error || state.error || view.error}
          </Text>
          <Action
            label={uiText("Aggiorna")}
            onPress={() => {
              setError("");
              state.refresh();
              view.refresh();
            }}
          />
        </View>
      )}
      <PendingStrip commands={commands} />
      <ScrollView
        ref={scroll}
        onContentSizeChange={() => {
          if (atBottom.current)
            scroll.current?.scrollToEnd({ animated: false });
        }}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } =
            e.nativeEvent;
          atBottom.current =
            contentOffset.y + layoutMeasurement.height >=
            contentSize.height - 60;
        }}
        scrollEventThrottle={100}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 15, flexGrow: 1 }}
      >
        {view.snapshot?.messages.map((m) => {
          const turn = turnByMessage.get(m.id),
            r = researchByMessage.get(m.id),
            emme = m.actor_kind === "miriam";
          const failure = failedRequests?.get(m.id);
          return (
            <View key={m.id} style={{ gap: 6 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                {emme && <StudioIcon name="mark" size={18} color={p.emme} />}
                <Text
                  style={{ color: emme ? p.emme : p.muted, fontWeight: "600" }}
                >
                  {emme ? m.author_name : uiText("Tu")}
                </Text>
              </View>
              <Text
                selectable
                style={{
                  color: emme ? p.emme : p.text,
                  fontSize: 17,
                  lineHeight: 24,
                }}
              >
                {m.content}
              </Text>
              {failure && !turn && !r && (
                <AssistantFailureNotice {...{ failure, canRetry, commands }} />
              )}
              {m.reference?.kind === "source" &&
                (() => {
                  const file = view.snapshot?.sources.find(
                    (f) => f.id === m.reference?.id,
                  );
                  return file?.filename && !file.withdrawn ? (
                    <Action
                      variant="quiet"
                      icon="attach"
                      label={file.filename}
                      onPress={() => setPreviewId(file.id)}
                    />
                  ) : null;
                })()}
              {turn && (
                <>
                  <Text
                    selectable
                    style={{ color: p.emme, fontSize: 17, lineHeight: 24 }}
                  >
                    {turn.answer ??
                      (turn.status === "unavailable"
                        ? uiText(
                            "La conversazione di origine non è accessibile.",
                          )
                        : turn.status === "pending"
                          ? uiText("Consultazione in corso…")
                          : uiText("Risposta non disponibile."))}
                  </Text>
                  {turn.status === "ready" &&
                    turn.references.map((ref) => (
                      <Action
                        key={ref.id + ref.kind + ref.version}
                        variant="quiet"
                        label={ref.label}
                        onPress={() =>
                          setInspected({
                            turnId: turn.id,
                            target: turn.target,
                            ref,
                          })
                        }
                      />
                    ))}
                </>
              )}
              {r && (
                <Action
                  label={
                    r.status === "ready"
                      ? uiText("Ricerca pronta")
                      : uiText("Dettagli ricerca")
                  }
                  onPress={() => openResult(r)}
                />
              )}
            </View>
          );
        })}
        {view.snapshot?.messages.length === 0 && (
          <Text style={{ color: p.muted }}>
            {uiText("Cosa vuoi chiedere a Emme?")}
          </Text>
        )}
      </ScrollView>
      <View
        style={{
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: p.line,
          gap: 6,
        }}
      >
        {draft.error && (
          <Text accessibilityRole="alert" style={{ color: p.text }}>
            {draft.error}
          </Text>
        )}
        <View
          style={{
            borderWidth: 1,
            flexDirection: compactWriting ? "row" : "column",
            alignItems: compactWriting ? "center" : "stretch",
            borderColor: p.controlLine,
            borderRadius: 15,
            backgroundColor: p.field,
            paddingHorizontal: 9,
            paddingVertical: 3,
          }}
        >
          <TextInput
            disableFullscreenUI
            accessibilityLabel={
              target?.id
                ? uiText("Domanda privata sullo spazio")
                : uiText("Messaggio privato a Emme")
            }
            placeholder={
              target?.id
                ? uiText("Chiedi di questa conversazione…")
                : uiText("Scrivi a Emme…")
            }
            placeholderTextColor={p.muted}
            value={text}
            onChangeText={(text) => draft.edit({ text })}
            editable={!disabled}
            multiline
            maxLength={target?.id ? 2000 : 11990}
            style={{
              minHeight: 44,
              ...(compactWriting ? { flex: 1, minWidth: 0 } : {}),
              maxHeight: compactWriting ? 60 : 104,
              color: p.text,
              fontSize: 17,
              paddingHorizontal: 8,
              paddingVertical: 8,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("Allega file")}
              disabled={disabled}
              onPress={() => setTools("attach")}
              style={{
                minWidth: 48,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <StudioIcon name="attach" color={p.muted} />
            </Pressable>
            <Action
              variant="quiet"
              icon="plus"
              label={uiText("Azioni")}
              onPress={() => setTools("actions")}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("Invia")}
              accessibilityState={{ disabled: disabled || !text.trim() }}
              disabled={disabled || !text.trim()}
              onPress={send}
              style={{
                width: 48,
                minHeight: 48,
                borderRadius: 24,
                backgroundColor: p.accent,
                opacity: disabled || !text.trim() ? 0.5 : 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <StudioIcon name="send" color={p.onAccent} />
            </Pressable>
          </View>
        </View>
      </View>
      {tools === "attach" && (
        <Panel title={uiText("Salva allegato")} onClose={() => setTools(null)}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SourceUpload personalChat commands={commands} />
          </ScrollView>
        </Panel>
      )}
      {inspected &&
        current?.turns.some(
          (turn) =>
            turn.id === inspected.turnId &&
            turn.target === inspected.target &&
            turn.status === "ready",
        ) && (
          <ConsultedSource
            key={inspected.target + inspected.ref.id + inspected.ref.version}
            request={request}
            target={inspected.target}
            entry={inspected.ref}
            onClose={() => setInspected(null)}
            onSource={(id) =>
              setInspected({
                ...inspected,
                ref: {
                  kind: "source",
                  id,
                  version: 1,
                  label: uiText("Fonte originale"),
                },
              })
            }
          />
        )}
      {previewId && (
        <Panel
          title={uiText("Allegato personale")}
          onClose={() => setPreviewId(null)}
        >
          <ScrollView>
            <AttachmentPreview
              request={request}
              path={
                workspacePath(thread) +
                "/source-file?id=" +
                encodeURIComponent(previewId)
              }
            />
          </ScrollView>
        </Panel>
      )}
      {tools === "target" && (
        <Panel
          title={uiText("Consulta una conversazione")}
          onClose={() => setTools(null)}
        >
          <ScrollView contentContainerStyle={{ gap: 8 }}>
            {(current?.targets ?? []).map((t) => (
              <Action
                key={t.id}
                label={t.name}
                disabled={disabled}
                primary={t.id === target?.id}
                onPress={() => select(t.id)}
              />
            ))}
            {!current?.targets.length && (
              <Text style={{ color: p.muted }}>
                {uiText("Nessuno spazio consultabile.")}
              </Text>
            )}
          </ScrollView>
        </Panel>
      )}
      {tools === "research" && (
        <Panel
          title={uiText("Ricerca approfondita")}
          onClose={() => setTools(null)}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 12 }}
          >
            <Field
              label={uiText("Cosa vuoi approfondire?")}
              value={query}
              onChangeText={setQuery}
              multiline
              maxLength={500}
            />
            <Consent
              text="Autorizzo l’invio della ricerca al servizio esterno e l’analisi degli estratti. Il risultato resta privato."
              value={allow}
              change={setAllow}
            />
            <Consent
              text="Avvisami quando è pronta"
              value={notify}
              change={setNotify}
            />
            <Action
              label={uiText("Avvia ricerca privata")}
              primary
              disabled={disabled || !allow || !query.trim()}
              onPress={() =>
                void commands.send({
                  kind: "command",
                  label: "Ricerca privata",
                  command: {
                    type: "research.private_request",
                    query: query.trim(),
                    discloseQuery: true,
                    analyzeExcerpts: true,
                    notify,
                    ...(target?.id ? { originId: target.id } : {}),
                  },
                })
              }
            />
            <PendingStrip commands={commands} />
          </ScrollView>
        </Panel>
      )}
      {tools === "document" && (
        <Panel
          title={uiText("Documento personale")}
          onClose={() => setTools(null)}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 10 }}
          >
            {doc ? (
              <>
                <Text
                  selectable
                  style={{ color: p.text, fontSize: 17, lineHeight: 24 }}
                >
                  {doc.answer}
                </Text>
                <Action
                  label={uiText("Apri Documenti personali")}
                  onPress={() => {
                    setTools(null);
                    onTab("documents");
                  }}
                />
              </>
            ) : (
              <>
                <Field
                  label={uiText("Descrivi il documento da preparare")}
                  value={query}
                  onChangeText={setQuery}
                  maxLength={2000}
                  multiline
                />
                <Text style={{ color: p.muted }}>
                  {uiText(
                    "L’anteprima verrà salvata nei tuoi documenti personali.",
                  )}
                </Text>
                <Action
                  label={uiText("Prepara anteprima")}
                  primary
                  disabled={acting || !query.trim()}
                  onPress={prepareDocument}
                />
              </>
            )}
            {!!error && <Text style={{ color: p.text }}>{error}</Text>}
          </ScrollView>
        </Panel>
      )}
      {chosen && (
        <Panel
          title={uiText("Ricerca privata")}
          onClose={() => setResult(null)}
        >
          <ScrollView contentContainerStyle={{ gap: 9 }}>
            <Text style={{ color: p.text, fontWeight: "600" }}>
              {chosen.query}
            </Text>
            <Text
              selectable
              style={{ color: p.text, fontSize: 17, lineHeight: 24 }}
            >
              {chosen.summary ??
                (chosen.error
                  ? uiText("Ricerca non disponibile.")
                  : uiText("In elaborazione…"))}
            </Text>
            {chosen.citations
              .filter((c) => /^https?:\/\//i.test(c.url))
              .map((c) => (
                <Action
                  key={c.id}
                  label={c.title}
                  onPress={() =>
                    Alert.alert(uiText("Aprire la fonte esterna?"), c.url, [
                      { text: uiText("Annulla"), style: "cancel" },
                      {
                        text: uiText("Apri"),
                        onPress: () => {
                          void Linking.openURL(c.url).catch((e) =>
                            setError(describe(e)),
                          );
                        },
                      },
                    ])
                  }
                />
              ))}
            {chosen.status === "ready" && (
              <>
                <Text style={{ color: p.muted }}>
                  {uiText("Condividi il risultato nello spazio che scegli.")}
                </Text>
                {current?.targets
                  .filter((t) => t.contributes)
                  .map((t) => (
                    <Action
                      key={t.id}
                      primary={dest === t.id}
                      label={t.name}
                      onPress={() => setDest(t.id)}
                    />
                  ))}
                {destination && (
                  <Action
                    primary
                    label={
                      chosen.shared.includes(destination.id)
                        ? uiText("Già condiviso")
                        : uiText("Condividi in {0}", String(destination.name))
                    }
                    disabled={
                      disabled || chosen.shared.includes(destination.id)
                    }
                    onPress={() =>
                      void commands.send({
                        kind: "command",
                        label: "Condividi ricerca in " + destination.name,
                        command: {
                          type: "research.private_publish",
                          destinationId: destination.id,
                          workId: chosen.id,
                          generation: chosen.generation,
                        },
                      })
                    }
                  />
                )}
              </>
            )}
            {!!chosen.error && (
              <Action
                label={uiText("Riprova ricerca")}
                disabled={disabled}
                onPress={() =>
                  void commands.send({
                    kind: "command",
                    label: "Riprova ricerca",
                    command: chosen.brief
                      ? {
                          type: "research.brief_retry",
                          workId: chosen.id,
                          generation: chosen.generation,
                        }
                      : { type: "research.retry", workId: chosen.id },
                  })
                }
              />
            )}
            <PendingStrip commands={commands} />
          </ScrollView>
        </Panel>
      )}
    </View>
  );
}
function Consent({
  value,
  text,
  change,
}: {
  value: boolean;
  text: string;
  change: (v: boolean) => void;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <Switch accessibilityLabel={text} value={value} onValueChange={change} />
      <Text style={{ color: p.text, flex: 1 }}>{text}</Text>
    </View>
  );
}
