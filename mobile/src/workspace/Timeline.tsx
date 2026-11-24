import { useUiLanguage } from "../i18n";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  ScrollView,
  useWindowDimensions,
  type ViewToken,
} from "react-native";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { ConversationReference } from "../../../src/contracts/activity";
import type { PersonalReading } from "../../../src/contracts/conversation-reading";
import {
  joinsByFollowingMessage,
  initialConversationTarget,
  settledVisibleIds,
} from "./entry";
import { ProtectedImage } from "../ProtectedImage";
import { isSharedPhoto } from "../../../src/shared/photo-media-type";
import { StudioIcon } from "../StudioIcon";
import { Panel } from "./SharedFiles";
import { ConversationDialog } from "./ConversationDialog";
import { HomeAvatar } from "../AppShell";
import type { PhotoDirectory } from "../../../src/contracts/identity-photos";
import {
  messageDay,
  mobileDayLabel,
  chatClock,
  startsReadingInterval,
} from "../../../src/shared/conversation-presentation";

import { post, type NativeRequest } from "../api";
import { Action, usePalette } from "../ui";

import { assistantRequestFailures } from "../../../src/shared/assistant-request-failures";
import { AssistantFailureNotice } from "./AssistantFailureNotice";
import type { ConsultationRef } from "../../../src/contracts/private-consultation";
import type { Commands } from "./useCommands";
import type { Tool } from "./WorkspaceTools";
import { ReminderRow, TaskOfferRow } from "./ChatRecord";
import { useTimelineExtras } from "./timeline-extras";
import { HandoffReview } from "./HandoffReview";
import type { ConversationHandoff } from "../../../src/contracts/conversation-handoff";
import { AnswerRequest } from "./AnswerRequest";

type Message = Snapshot["messages"][number];
export function Timeline({
  visible,
  allMessages,
  onOriginal,
  photos,
  assistantName,
  snapshot,
  request,
  path,
  actorId,
  origin,
  refresh,
  initialMessageId,
  onQuote,
  onRef,
  onFile,
  commands,
  canWrite,
  online,
  onTool,
  onConsultReference,
  onIntegration,
  onPerson,
  onRecap,
  voiceIds,
  onVoice,
}: {
  visible: boolean;
  allMessages?: Snapshot["messages"];
  onOriginal: (id: string) => void;
  photos?: PhotoDirectory;
  snapshot: Snapshot;
  assistantName: string;
  request: NativeRequest;
  path: string;
  actorId: string;
  origin: string;
  refresh: () => void;
  initialMessageId?: string;
  onQuote: (message: Message, ask: boolean) => void;
  onRef: (r: ConversationReference) => void;
  onFile: (s: Snapshot["sources"][number]) => void;
  commands: Commands;
  canWrite: boolean;
  online: boolean;
  onTool: (tool: Tool, item?: string) => void;
  onIntegration: (t: "email" | "calendar") => void;
  onConsultReference: (r: ConsultationRef) => void;
  onPerson: (id: string, name: string) => void;
  onRecap: (id: string) => void;
  voiceIds: ReadonlySet<string>;
  onVoice: (id: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const { width } = useWindowDimensions();
  const compact = width < 761;
  const isVisible = useRef(visible);
  isVisible.current = visible;
  const list = useRef<FlatList<Message>>(null);
  const extras = useTimelineExtras(
    request,
    path,
    snapshot.messages[0]?.id,
    snapshot.messages.at(-1)?.id,
    snapshot.workspace.revision,
  );
  const [review, setReview] = useState<ConversationHandoff | null>(null);
  const joins = useMemo(
    () => joinsByFollowingMessage(snapshot.messages, snapshot.joins ?? []),
    [snapshot.messages, snapshot.joins],
  );
  function joinRows(id: string) {
    return joins.get(id)?.map((j) => (
      <Text
        key={j.id}
        style={{
          textAlign: "center",
          fontSize: 13,
          paddingVertical: 7,
          color: p.muted,
        }}
      >
        {uiText("Ingresso nello spazio · ")}
        {j.name}
      </Text>
    ));
  }
  const [menu, setMenu] = useState<string | null>(null);
  const reversed = useMemo(
    () => [...snapshot.messages].reverse(),
    [snapshot.messages],
  );
  const byId = useMemo(
    () =>
      new Map(
        [...(allMessages ?? []), ...snapshot.messages].map((m) => [m.id, m]),
      ),
    [allMessages, snapshot.messages],
  );
  const failedRequests = useMemo(
    () =>
      assistantRequestFailures([...byId.values()], snapshot.interpretations),
    [byId, snapshot.interpretations],
  );
  const files = useMemo(() => {
    const result = new Map<string, Snapshot["sources"]>();
    for (const f of snapshot.sources) {
      if (f.shared_message_id) {
        const a = result.get(f.shared_message_id) ?? [];
        a.push(f);
        result.set(f.shared_message_id, a);
      }
    }
    for (const entries of result.values())
      entries.sort(
        (a, b) => (a.attachment_position ?? 0) - (b.attachment_position ?? 0),
      );
    return result;
  }, [snapshot.sources]);
  const [jump, setJump] = useState<string | null>(() =>
    initialConversationTarget(
      snapshot.messages,
      snapshot.reading?.mentionIds ?? [],
      initialMessageId,
    ),
  );
  const [firstUnread] = useState(() => {
    const ids = new Set(snapshot.reading?.unreadIds);
    return snapshot.messages.find((m) => ids.has(m.id))?.id;
  });
  const [away, setAway] = useState(false);
  const [mentions, setMentions] = useState(snapshot.reading?.mentionIds ?? []);
  const [readError, setReadError] = useState(false);
  const alive = useRef(true);
  const reading = useRef(snapshot.reading);
  const queued = useRef(new Set<string>());
  const flushing = useRef(false);
  const anchor = useRef<{ id: string; atBottom: boolean } | null>(null);
  const generation = useRef(0);
  const scrollDistance = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const recent = snapshot.reading;
    if (
      recent &&
      (!reading.current ||
        recent.admission !== reading.current.admission ||
        recent.cursorVersion >= reading.current.cursorVersion)
    ) {
      reading.current = recent;
      setMentions(recent.mentionIds);
    }
  }, [snapshot.reading]);
  const flush = useCallback(async () => {
    if (flushing.current || !reading.current || !anchor.current) return;
    const current = reading.current;
    const seen = [...queued.current].slice(0, 100);
    const target = anchor.current;
    const epoch = generation.current;
    if (
      !seen.length &&
      target.id === current.anchorId &&
      target.atBottom === !!current.anchorAtBottom
    )
      return;
    flushing.current = true;
    try {
      const receipt = await request<{ cursorVersion: number }>(
        path + "/reading",
        post({
          expectedActorId: actorId,
          admission: current.admission,
          seen,
          anchor: {
            ...target,
            offset: 0,
            expectedVersion: current.cursorVersion,
          },
        }),
      );
      const latest = reading.current ?? current;
      if (latest.admission === current.admission)
        reading.current = {
          ...latest,
          cursorVersion: Math.max(latest.cursorVersion, receipt.cursorVersion),
          unreadIds: latest.unreadIds.filter((id) => !seen.includes(id)),
          mentionIds: latest.mentionIds.filter((id) => !seen.includes(id)),
          ...(receipt.cursorVersion === current.cursorVersion + 1 &&
          latest.cursorVersion <= current.cursorVersion
            ? {
                anchorId: target.id,
                anchorAtBottom: target.atBottom,
                anchorOffset: 0,
              }
            : {}),
        };
      for (const id of seen) queued.current.delete(id);
      if (alive.current) {
        setReadError(false);
        setMentions(reading.current?.mentionIds ?? []);
        if (generation.current !== epoch) void Promise.resolve().then(flush);
      }
    } catch {
      // Refresh the version before another user-driven update if this device lost an anchor race.
      try {
        reading.current = await request<PersonalReading>(path + "/reading");
      } catch {
        /* the next visible read retries */
      }
      if (alive.current) setReadError(true);
    } finally {
      flushing.current = false;
    }
  }, [actorId, path, request]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const jumpRef = useRef(jump);
  jumpRef.current = jump;
  const viewChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
      if (!isVisible.current || !viewableItems.length || jumpRef.current)
        return;
      const visible = viewableItems.filter((v) => v.isViewable);
      if (!visible.length) return;
      for (const v of visible) {
        if (
          reading.current?.unreadIds.includes(v.item.id) ||
          reading.current?.mentionIds.includes(v.item.id)
        )
          queued.current.add(v.item.id);
      }
      const atBottom = scrollDistance.current < 40;
      const top = atBottom ? visible[0] : visible[visible.length - 1];
      anchor.current = { id: top.item.id, atBottom };
      generation.current++;
      void flushRef.current();
    },
  ).current;
  const viewConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 350,
  }).current;
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(
    () => () => {
      clearTimeout(jumpTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!jump) return;
    const index = reversed.findIndex((m) => m.id === jump);
    if (index < 0) {
      setJump(null);
      return;
    }
    const t = setTimeout(
      () =>
        list.current?.scrollToIndex({
          index,
          animated: false,
          viewPosition: 0.45,
        }),
      100,
    );
    return () => clearTimeout(t);
  }, [jump, reversed]);
  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
      if (!isVisible.current) return;
      const ids = viewableItems
        .filter((v) => v.isViewable)
        .map((v) => v.item.id);
      if (!settledVisibleIds(ids, jumpRef.current).length) return;
      if (
        jumpRef.current &&
        viewableItems.some((v) => v.isViewable && v.item.id === jumpRef.current)
      ) {
        jumpRef.current = null;
        setJump(null);
      }
      viewChanged({ viewableItems });
    },
  ).current;
  const [sources, setSources] = useState<Message | null>(null);
  const selectedMessage = menu ? byId.get(menu) : undefined;
  return (
    <View style={{ flex: 1 }}>
      {mentions.length > 0 && !jump && (
        <Action
          label={uiText("@ Menzione successiva · {0}", String(mentions.length))}
          onPress={() => {
            const ids = new Set(reading.current?.mentionIds ?? []);
            const next = snapshot.messages.find(
              (m) => ids.has(m.id) && !queued.current.has(m.id),
            );
            if (next) {
              jumpRef.current = next.id;
              setJump(next.id);
            }
          }}
        />
      )}
      {readError && (
        <Action
          label={uiText("Aggiorna punto di lettura")}
          onPress={() => void flush()}
        />
      )}
      <FlatList
        ref={list}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: compact ? 16 : 28,
          paddingBottom: 8,
          paddingTop: 8,
          width: "100%",
          maxWidth: 920,
          alignSelf: "center",
        }}
        data={reversed}
        inverted={reversed.length > 0}
        keyExtractor={(m) => m.id}
        viewabilityConfig={viewConfig}
        onViewableItemsChanged={onViewable}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          scrollDistance.current = y;
          setAway(y > 140);
        }}
        scrollEventThrottle={100}
        onScrollToIndexFailed={(info) => {
          list.current?.scrollToOffset({
            offset: Math.max(0, info.averageItemLength * info.index),
            animated: false,
          });
          clearTimeout(jumpTimer.current);
          jumpTimer.current = setTimeout(() => {
            if (jumpRef.current)
              list.current?.scrollToIndex({
                index: info.index,
                animated: false,
                viewPosition: 0.45,
              });
          }, 150);
        }}
        ListHeaderComponent={<>{joinRows("")}</>}
        ListEmptyComponent={
          <Text style={{ color: p.muted, paddingVertical: 24 }}>
            {uiText("Inizia la conversazione.")}
          </Text>
        }
        renderItem={({ item: m, index }) => {
          const prev = reversed[index + 1];
          const newDay =
            !prev ||
            messageDay(prev.created_at, locale) !==
              messageDay(m.created_at, locale);
          const interval =
            !!prev &&
            !newDay &&
            startsReadingInterval(prev.created_at, m.created_at);
          const continuation =
            !!prev &&
            !newDay &&
            !interval &&
            m.purpose !== "followup_reminder" &&
            prev.purpose !== "followup_reminder" &&
            prev.actor_kind === m.actor_kind &&
            ((m.actor_kind === "miriam" &&
              prev.author_name === m.author_name) ||
              (!!m.author_id && prev.author_id === m.author_id));
          const isEmme = m.actor_kind === "miriam";
          const attachments = files.get(m.id) ?? [];
          const filenameOnly =
            !!attachments.length &&
            m.content === attachments.map((f) => f.filename).join(", ");
          const milestone =
            (m.purpose === "goal_event" || m.purpose === "workstream_event") &&
            m.reference;
          const failure = failedRequests.get(m.id);
          const pendingAnswer = snapshot.reading?.requestIds.includes(m.id);
          const quoted = m.quoteMessageId ? byId.get(m.quoteMessageId) : null;
          return (
            <View
              style={{
                paddingTop: continuation ? 3 : 12,
                paddingBottom: 8,
                gap: 3,
              }}
            >
              {joinRows(m.id)}
              {(newDay || (compact && interval)) && (
                <View
                  style={{
                    flexDirection: "row",
                    gap: 7,
                    alignItems: "center",
                    marginBottom: 9,
                  }}
                >
                  <Text
                    style={{ color: p.muted, fontSize: 13, fontWeight: "600" }}
                  >
                    {newDay
                      ? compact
                        ? mobileDayLabel(m.created_at, undefined, locale) +
                          " · " +
                          chatClock(m.created_at, locale)
                        : messageDay(m.created_at, locale)
                      : chatClock(m.created_at, locale)}
                  </Text>
                  <View
                    style={{ height: 1, backgroundColor: p.line, flex: 1 }}
                  />
                </View>
              )}
              {milestone ? (
                <Action
                  variant="quiet"
                  icon={m.purpose === "goal_event" ? "goal" : "branch"}
                  label={m.author_name + " " + m.content}
                  onPress={() => onRef(milestone)}
                />
              ) : (
                <View style={{ paddingRight: 44, minHeight: 40, gap: 3 }}>
                  {!continuation && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      {isEmme && (
                        <StudioIcon name="mark" color={p.emme} size={17} />
                      )}
                      {!compact && !isEmme && m.author_id && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={m.author_name}
                          onPress={() => onPerson(m.author_id!, m.author_name)}
                        >
                          <HomeAvatar
                            name={m.author_name}
                            size={28}
                            request={request}
                            path={
                              photos?.members[m.author_id]?.present
                                ? "/api/v1/identity-photos?image=1&workspace=" +
                                  snapshot.workspace.id +
                                  "&person=" +
                                  m.author_id +
                                  "&v=" +
                                  photos.members[m.author_id].version
                                : undefined
                            }
                          />
                        </Pressable>
                      )}
                      <Text
                        numberOfLines={1}
                        accessibilityRole={
                          m.author_id && !isEmme ? "button" : undefined
                        }
                        onPress={
                          m.author_id && !isEmme
                            ? () => onPerson(m.author_id!, m.author_name)
                            : undefined
                        }
                        style={{
                          flexShrink: 1,
                          fontSize: 15,
                          fontWeight: "600",
                          color: isEmme ? p.emme : p.text,
                        }}
                      >
                        {m.author_name}
                      </Text>
                      {!compact && (
                        <Text style={{ fontSize: 13, color: p.muted }}>
                          {chatClock(m.created_at, locale)}
                        </Text>
                      )}
                    </View>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={uiText(
                      "Azioni per il messaggio di {0}",
                      String(m.author_name),
                    )}
                    onPress={() => setMenu(m.id)}
                    style={({ pressed }) => ({
                      position: "absolute",
                      right: 0,
                      top: -5,
                      width: 44,
                      height: 44,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: pressed ? p.panel : "transparent",
                      borderRadius: 8,
                    })}
                  >
                    <StudioIcon name="more" size={20} color={p.muted} />
                  </Pressable>
                  {m.id === firstUnread && (
                    <Action
                      variant="quiet"
                      label={uiText("Riassumi da qui")}
                      onPress={() => onRecap(m.id)}
                    />
                  )}
                  {quoted && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        if (reversed.some((row) => row.id === quoted.id))
                          setJump(quoted.id);
                        else onOriginal(quoted.id);
                      }}
                      style={{
                        borderLeftColor: p.line,
                        borderLeftWidth: 2,
                        paddingLeft: 8,
                      }}
                    >
                      <Text numberOfLines={2} style={{ color: p.muted }}>
                        {quoted.author_name} · {quoted.content}
                      </Text>
                    </Pressable>
                  )}
                  {voiceIds.has(m.id) && (
                    <Action
                      label={uiText("Ascolta vocale e leggi trascrizione")}
                      onPress={() => onVoice(m.id)}
                    />
                  )}
                  {pendingAnswer && (
                    <Text style={{ color: p.muted }}>
                      {uiText("In attesa della tua risposta")}
                    </Text>
                  )}
                  {!filenameOnly && !!m.content && (
                    <Text
                      selectable
                      style={{
                        color: isEmme ? p.emme : p.text,
                        fontSize: 17,
                        lineHeight: 25.5,
                      }}
                    >
                      {m.content}
                    </Text>
                  )}
                  {attachments.map((f) =>
                    f.withdrawn ? (
                      <Text key={f.id} style={{ color: p.muted }}>
                        {uiText("File ritirato")}
                      </Text>
                    ) : (
                      <View key={f.id} style={{ gap: 4, marginVertical: 5 }}>
                        <Pressable
                          key={f.id}
                          accessibilityRole="button"
                          accessibilityLabel={uiText(
                            "Apri anteprima di {0}",
                            String(f.filename ?? f.title),
                          )}
                          onPress={() => onFile(f)}
                          style={{
                            minHeight: 44,
                            justifyContent: "center",
                            alignSelf: "flex-start",
                          }}
                        >
                          {isSharedPhoto(f.media_type) && (
                            <ProtectedImage
                              request={request}
                              path={path + "/source-file?id=" + f.id}
                              mediaType={f.media_type!}
                              label={f.filename ?? f.title}
                              style={{
                                width: 160,
                                height: 105,
                                borderRadius: 6,
                              }}
                            />
                          )}
                          <Text style={{ color: p.accent, fontWeight: "600" }}>
                            {f.filename ?? f.title}
                          </Text>
                        </Pressable>
                        {f.media_type === "text/plain" && !!f.content && (
                          <Text
                            style={{
                              color: p.muted,
                              lineHeight: 25.5,
                              fontSize: 17,
                            }}
                          >
                            {f.content.length > 220
                              ? f.content.slice(0, 220) + "…"
                              : f.content}
                          </Text>
                        )}
                      </View>
                    ),
                  )}
                  {m.reference && (
                    <Action
                      label={uiText("Vedi riferimento")}
                      onPress={() => onRef(m.reference!)}
                    />
                  )}
                  {m.consultationReferences?.map((r) => (
                    <Action
                      key={[r.kind, r.id, r.version].join(":")}
                      label={r.label}
                      onPress={() => onConsultReference(r)}
                    />
                  ))}
                  {m.operationResult?.workstreamId && (
                    <Action
                      label={uiText(
                        "Apri argomento · {0}",
                        String(m.operationResult.title),
                      )}
                      onPress={() =>
                        onTool("Argomenti", m.operationResult!.workstreamId)
                      }
                    />
                  )}
                  {failure && (
                    <AssistantFailureNotice
                      failure={failure}
                      canRetry={canWrite && online}
                      commands={commands}
                    />
                  )}
                  {m.reminder && (
                    <ReminderRow
                      key={m.reminder.version ?? m.id}
                      r={m.reminder}
                      messageId={m.id}
                      workspaceId={snapshot.workspace.id}
                      actor={actorId}
                      {...{ commands, origin, request, refresh }}
                    />
                  )}
                  {m.taskOffer && (
                    <TaskOfferRow
                      offer={m.taskOffer}
                      actor={actorId}
                      commands={commands}
                      open={() => onTool("In programma", m.taskOffer!.taskId)}
                    />
                  )}
                  {m.citation_source_ids.length <= 1 &&
                    m.citation_source_ids.map((source, i) => (
                      <Pressable
                        key={source}
                        accessibilityRole="button"
                        onPress={() =>
                          onRef({ kind: "source", id: source, version: 1 })
                        }
                        style={{ minHeight: 36, justifyContent: "center" }}
                      >
                        <Text style={{ color: p.emme }}>
                          {uiText("Fonte ")}
                          {i + 1} ↗
                        </Text>
                      </Pressable>
                    ))}
                  {m.citation_source_ids.length > 1 && (
                    <Action
                      label={uiText(
                        "{0} fonti",
                        String(m.citation_source_ids.length),
                      )}
                      variant="quiet"
                      onPress={() => setSources(m)}
                    />
                  )}
                  {(extras.anchored.get(m.id) ?? []).map((item) => (
                    <Action
                      key={item.id}
                      variant="quiet"
                      icon={item.kind === "decision" ? "check" : "work"}
                      label={
                        (item.kind === "decision"
                          ? uiText("Decisione · ")
                          : uiText("Lavoro completato · ")) + item.label
                      }
                      onPress={() => {
                        if (item.kind === "decision")
                          onRef({
                            kind: "commitment",
                            id: item.objectId,
                            version: 1,
                          });
                        else if (item.completionRevision)
                          onRef({
                            kind: "active_work",
                            id: item.objectId,
                            version: item.completionRevision,
                          });
                        else onTool("Attività di Emme", item.objectId);
                      }}
                    />
                  ))}
                  {(extras.suggested.get(m.id) ?? []).map((h) => (
                    <Action
                      key={h.id}
                      label={
                        (h.status === "applied"
                          ? uiText("Passaggio registrato · ")
                          : h.status === "stale"
                            ? uiText("Da rivedere · ")
                            : uiText("Suggerimento · ")) + h.summary
                      }
                      onPress={() => setReview(h)}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        }}
      />
      {sources && (
        <Panel title={uiText("Fonti")} onClose={() => setSources(null)}>
          <ScrollView>
            {sources.citation_source_ids.map((id, i) => (
              <Action
                key={id}
                label={
                  snapshot.sources.find((source) => source.id === id)?.title ??
                  uiText("Fonte {0}", String(i + 1))
                }
                variant="quiet"
                onPress={() => {
                  setSources(null);
                  onRef({ kind: "source", id, version: 1 });
                }}
              />
            ))}
          </ScrollView>
        </Panel>
      )}
      {selectedMessage && (
        <ConversationDialog
          compact
          title={uiText("Azioni del messaggio")}
          onClose={() => setMenu(null)}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 6 }}
          >
            {canWrite && (
              <>
                <Action
                  label={uiText("Rispondi")}
                  onPress={() => {
                    setMenu(null);
                    onQuote(selectedMessage, false);
                  }}
                />
                <Action
                  label={uiText("Chiedi a {0}", String(assistantName))}
                  onPress={() => {
                    setMenu(null);
                    onQuote(selectedMessage, true);
                  }}
                />
                <Action
                  label={uiText("Apri una domanda")}
                  onPress={() => {
                    setMenu(null);
                    onTool("Domande", selectedMessage.id);
                  }}
                />
              </>
            )}
            {extras.source === selectedMessage.id &&
              !extras.suggested.get(selectedMessage.id)?.length && (
                <Text style={{ color: p.muted }}>
                  {uiText("Nessun passaggio associato.")}
                </Text>
              )}
            <Action
              label={uiText("Passaggi collegati a questo messaggio")}
              onPress={() => extras.load(selectedMessage.id)}
            />
            {!!extras.error && (
              <Action
                label={uiText("Riprova lettura dei passaggi")}
                onPress={extras.retry}
              />
            )}
            <AnswerRequest
              {...{ commands, snapshot, canWrite, actorId }}
              messageId={selectedMessage.id}
              onDone={() => setMenu(null)}
            />
          </ScrollView>
        </ConversationDialog>
      )}
      {review && (
        <HandoffReview
          key={review.id}
          snapshot={snapshot}
          h={
            (extras.suggested.get(review.sourceMessageId) ?? []).find(
              (h) => h.id === review.id,
            ) ?? review
          }
          actor={actorId}
          {...{ request, path, commands, canWrite }}
          onClose={() => setReview(null)}
          onRef={(r) => {
            setReview(null);
            onRef(r);
          }}
          onIntegration={(t) => {
            setReview(null);
            onIntegration(t);
          }}
          onTool={(name) => {
            setReview(null);
            onTool(name);
          }}
        />
      )}
      {away && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setJump(null);
            list.current?.scrollToOffset({ offset: 0, animated: true });
          }}
          style={{
            alignSelf: "flex-end",
            marginRight: 10,
            padding: 8,
            backgroundColor: p.panel,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: p.text }}>{uiText("Vai in fondo ↓")}</Text>
        </Pressable>
      )}
    </View>
  );
}
