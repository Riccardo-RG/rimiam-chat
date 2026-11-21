import { useUiLanguage } from "./i18n";
import { useKeyboardVisible } from "./useKeyboardVisible";
import { ChatViewport } from "./ChatViewport";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  TextInput,
  useWindowDimensions,
  type ViewToken,
} from "react-native";
import { randomUUID } from "expo-crypto";
import type { DirectView, DirectInput } from "../../src/contracts/direct-chat";
import type { ParticipantProfile } from "../../src/contracts/participant-profile";
import { post, problem, type NativeRequest } from "./api";
import { StudioIcon } from "./StudioIcon";
import { Action, usePalette } from "./ui";
import { useResource } from "./useResource";
import { ProtectedImage } from "./ProtectedImage";
import { isSharedPhoto } from "../../src/shared/photo-media-type";
import { AttachmentPreview } from "./AttachmentPreview";
import { Panel } from "./workspace/SharedFiles";
import { useCommands } from "./workspace/useCommands";
import { Attachments } from "./workspace/Attachments";
import { useComposerDraft } from "./workspace/useComposerDraft";
import { PendingStrip } from "./workspace/PendingStrip";

type Message = DirectView["messages"][number];
export function DirectScreen({
  request,
  actorId,
  origin,
  id,
  name,
  onBack,
  onCreate,
}: {
  request: NativeRequest;
  actorId: string;
  origin: string;
  id: string;
  name: string;
  onBack: () => void;
  onCreate: (contact: { id: string; name: string }) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const c = usePalette(),
    path = "/api/v1/direct-chats/" + id;
  const {
    value: view,
    error,
    refresh,
  } = useResource<DirectView>(request, path, 5500);
  const scope = useMemo(
    () => ({ origin, actorId, directId: id }),
    [origin, actorId, id],
  );
  const { width, fontScale, height } = useWindowDimensions();
  const narrow = width / fontScale <= 640;
  const typing = useKeyboardVisible();
  const compactWriting =
    typing && width > 520 && height < 540 && width > height;
  const composer = useRef<TextInput>(null);
  const [away, setAway] = useState(false);
  const draft = useComposerDraft(scope);
  const { text, files, quoteId } = draft.value;
  const quote = view?.messages.find((m) => m.id === quoteId);
  const [picking, setPicking] = useState(false),
    [sheet, setSheet] = useState(false),
    [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [preview, setPreview] = useState<{
    fileId: string;
    messageId: string;
  } | null>(null);
  const [notice, setNotice] = useState(""),
    [working, setWorking] = useState(false),
    [selected, setSelected] = useState<Message | null>(null);
  const list = useRef<FlatList<Message>>(null),
    initial = useRef(false),
    jumpAfter = useRef(false);
  const controls = useRef(false),
    actionId = useRef<{ key: string; id: string } | null>(null);
  const reading = useRef(view);
  reading.current = view;
  const visible = useRef<string[]>([]),
    seen = useRef(new Set<string>()),
    marking = useRef(false);
  const cursor = useRef(0),
    lastAnchor = useRef(""),
    atEnd = useRef(false),
    scrollIntent = useRef(false);
  const commands = useCommands(request, scope, (pending) => {
    draft.settled(pending.intent.draftToken);
    setPicking(false);
    jumpAfter.current = true;
    refresh();
  });
  const updateRead = useCallback(async () => {
    const state = reading.current;
    if (!state || marking.current || !initial.current) return;
    const ids = visible.current
      .filter(
        (i) => state.reading.unreadIds.includes(i) && !seen.current.has(i),
      )
      .slice(0, 100);
    const first = visible.current[0];
    const anchorKey = first + ":" + atEnd.current;
    const anchor =
      first && scrollIntent.current && anchorKey !== lastAnchor.current
        ? {
            id: first,
            offset: 0,
            expectedVersion: Math.max(
              cursor.current,
              state.reading.cursorVersion,
            ),
            atBottom: atEnd.current,
          }
        : undefined;
    if (!ids.length && !anchor) return;
    marking.current = true;
    try {
      const r = await request<{ cursorVersion: number }>(
        path,
        post({
          type: "read",
          expectedActorId: actorId,
          seen: ids,
          anchor,
        } satisfies DirectInput),
      );
      if (anchor) {
        cursor.current = r.cursorVersion;
        lastAnchor.current = anchorKey;
      }
      ids.forEach((i) => seen.current.add(i));
    } catch {
      refresh();
    } finally {
      marking.current = false;
    }
  }, [path, request, actorId, refresh]);
  const mark = useRef(updateRead);
  mark.current = updateRead;
  const onVisible = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
      visible.current = viewableItems
        .filter((v) => v.isViewable)
        .map((i) => i.item.id);
      void mark.current();
    },
  ).current;
  const jump = (target: string) => {
    const i = reading.current?.messages.findIndex((m) => m.id === target) ?? -1;
    if (i >= 0) list.current?.scrollToIndex({ index: i, animated: false });
  };
  const scrollToInitial = () => {
    if (!view?.messages.length) return;
    if (jumpAfter.current) {
      jumpAfter.current = false;
      list.current?.scrollToEnd({ animated: false });
      return;
    }
    if (initial.current) return;
    initial.current = true;
    const target = view.reading.anchorAtBottom
      ? null
      : (view.reading.anchorId ?? view.reading.unreadIds[0]);
    if (target) jump(target);
    else list.current?.scrollToEnd({ animated: false });
  };
  useEffect(() => {
    if (view && initial.current) void mark.current();
  }, [view]);
  const scrollTarget = useRef<number | null>(null),
    retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(retryTimer.current), []);
  async function control(value: "consent" | "recap") {
    if (!view || controls.current) return;
    controls.current = true;
    setWorking(true);
    setNotice("");
    const key = value + ":" + view.consentVersion;
    if (actionId.current?.key !== key)
      actionId.current = { key, id: randomUUID() };
    try {
      const base = { expectedActorId: actorId, id: actionId.current.id };
      await request(
        path,
        post(
          value === "recap"
            ? { ...base, type: "recap" }
            : {
                ...base,
                type: "consent",
                expectedVersion: view.consentVersion,
                enabled: !view.consent,
              },
        ),
      );
      actionId.current = null;
      refresh();
    } catch (e) {
      setNotice(problem(e));
    } finally {
      controls.current = false;
      setWorking(false);
    }
  }
  async function showProfile() {
    try {
      setProfile(await request<ParticipantProfile>(path + "/profile"));
    } catch (e) {
      setNotice(problem(e));
    }
  }
  if (!view || view.me !== actorId)
    return (
      <View style={{ padding: 16, gap: 8 }}>
        <Action label={uiText("‹ Home")} onPress={onBack} />
        <Text style={{ color: c.text }}>
          {error ||
            (view
              ? uiText("Questa conversazione non è disponibile.")
              : uiText("Apertura della conversazione…"))}
        </Text>
        {error && <Action label={uiText("Riprova")} onPress={refresh} />}
      </View>
    );
  const disabled =
    !draft.ready || commands.working || !!commands.pending || !commands.ready;
  const previewFile =
    preview &&
    view?.messages
      .find((m) => m.id === preview.messageId)
      ?.files.find((f) => f.id === preview.fileId);
  return (
    <ChatViewport backgroundColor={c.bg}>
      <View
        style={{
          flex: 1,
          width: "100%",
          alignSelf: "center",
          maxWidth: 1120,
          paddingHorizontal: width < 400 ? 10 : 16,
        }}
      >
        <View
          style={{
            display: compactWriting ? "none" : "flex",
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 6,
            paddingVertical: 4,
            borderBottomWidth: 1,
            borderColor: c.line,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText("Torna alla Home")}
            onPress={onBack}
            style={{
              minHeight: 48,
              minWidth: 48,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ rotate: "180deg" }],
            }}
          >
            <StudioIcon name="arrow" color={c.muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText("Profilo di {0}", String(name))}
            onPress={() => void showProfile()}
            style={{
              minHeight: 48,
              flex: 1,
              minWidth: 100,
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
            }}
          >
            {view?.peer.photoVersion ? (
              <ProtectedImage
                label={name}
                request={request}
                path={path + "/photo?v=" + view.peer.photoVersion}
                mediaType="image/jpeg"
                style={{ width: 34, height: 34, borderRadius: 17 }}
              />
            ) : (
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: c.panel,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: c.heading, fontWeight: "700" }}>
                  {name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((s) => s[0])
                    .join("")}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              {!typing && (
                <Text style={{ color: c.muted, fontSize: 13 }}>
                  {uiText("Chat privata")}
                </Text>
              )}
              <Text style={{ color: c.text, fontSize: 20, fontWeight: "700" }}>
                {name}
              </Text>
            </View>
          </Pressable>
          {view && !typing && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText(
                "Crea uno spazio con {0}",
                String(name),
              )}
              onPress={() =>
                onCreate({ id: view.peer.id, name: view.peer.name })
              }
              style={{
                maxWidth: "44%",
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
              }}
            >
              <StudioIcon name="space" color={c.muted} size={17} />
              <Text
                style={{
                  flexShrink: 1,
                  color: c.muted,
                  fontSize: 14,
                  fontWeight: "600",
                }}
              >
                {narrow
                  ? uiText("Crea uno spazio")
                  : uiText("Crea uno spazio con {0}", String(name))}
              </Text>
            </Pressable>
          )}
        </View>
        {view && !typing && (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "space-between",
              paddingVertical: height < 500 ? 0 : 2,
            }}
          >
            <Action
              variant="quiet"
              label={uiText("Riepilogo personale")}
              onPress={() => setSheet(true)}
            />
            {away && (
              <Action
                variant="quiet"
                label={uiText("Vai in fondo ↓")}
                onPress={() => {
                  list.current?.scrollToEnd({ animated: false });
                }}
              />
            )}
          </View>
        )}
        <FlatList
          ref={list}
          data={view?.messages ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, gap: 14 }}
          style={{ flex: 1 }}
          onContentSizeChange={scrollToInitial}
          onScrollBeginDrag={() => {
            scrollIntent.current = true;
          }}
          onScroll={(event) => {
            const { contentSize, layoutMeasurement, contentOffset } =
              event.nativeEvent;
            atEnd.current =
              contentSize.height - contentOffset.y - layoutMeasurement.height <
              24;
            setAway(!atEnd.current);
          }}
          onScrollEndDrag={() => void mark.current()}
          onMomentumScrollEnd={() => void mark.current()}
          onViewableItemsChanged={onVisible}
          viewabilityConfig={viewConfig}
          onScrollToIndexFailed={(info) => {
            list.current?.scrollToOffset({
              offset: Math.max(0, info.averageItemLength * info.index),
              animated: false,
            });
            if (scrollTarget.current !== info.index) {
              scrollTarget.current = info.index;
              clearTimeout(retryTimer.current);
              retryTimer.current = setTimeout(
                () =>
                  list.current?.scrollToIndex({
                    index: info.index,
                    animated: false,
                  }),
                120,
              );
            }
          }}
          renderItem={({ item, index }) => (
            <View style={{ gap: 3 }}>
              {(index === 0 ||
                new Date(view!.messages[index - 1].sentAt).toDateString() !==
                  new Date(item.sentAt).toDateString()) && (
                <Text
                  style={{
                    textAlign: "center",
                    color: c.muted,
                    marginVertical: 6,
                  }}
                >
                  {new Date(item.sentAt).toLocaleDateString(locale)}
                </Text>
              )}
              <Text
                onLongPress={() => setSelected(item)}
                onPress={() => setSelected(item)}
                style={{ color: c.text, fontWeight: "700" }}
              >
                {item.name}{" "}
                {!narrow && (
                  <Text
                    style={{ color: c.muted, fontWeight: "400", fontSize: 13 }}
                  >
                    {new Date(item.sentAt).toLocaleTimeString(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                )}
              </Text>
              {item.quoteId && (
                <Text
                  accessibilityRole="button"
                  onPress={() => jump(item.quoteId!)}
                  numberOfLines={1}
                  style={{ color: c.muted }}
                >
                  ↳{" "}
                  {view?.messages.find((m) => m.id === item.quoteId)?.text ||
                    uiText("Messaggio originale")}
                </Text>
              )}
              {!!item.text && (
                <Text
                  onLongPress={() => setSelected(item)}
                  selectable
                  style={{ color: c.text, fontSize: 17, lineHeight: 23 }}
                >
                  {item.text}
                </Text>
              )}
              {item.files.map((f) => (
                <Pressable
                  key={f.id}
                  accessibilityRole="button"
                  accessibilityLabel={uiText(
                    "Apri anteprima di {0}",
                    String(f.filename),
                  )}
                  onPress={() =>
                    setPreview({ fileId: f.id, messageId: item.id })
                  }
                  style={{
                    minHeight: 44,
                    justifyContent: "center",
                    alignSelf: "flex-start",
                  }}
                >
                  {isSharedPhoto(f.type) && (
                    <ProtectedImage
                      request={request}
                      path={path + "/files/" + f.id}
                      mediaType={f.type}
                      label={f.filename}
                      style={{ width: 160, height: 105, borderRadius: 6 }}
                    />
                  )}
                  <Text style={{ color: c.accent, fontWeight: "600" }}>
                    {f.filename}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={uiText("Rispondi a {0}", String(item.name))}
                onPress={() => {
                  draft.edit({ quoteId: item.id });
                  composer.current?.focus();
                }}
                style={{
                  alignSelf: "flex-start",
                  minHeight: 44,
                  justifyContent: "center",
                  paddingHorizontal: 8,
                }}
              >
                <Text
                  style={{ color: c.muted, fontWeight: "600", fontSize: 14 }}
                >
                  {uiText("Rispondi")}
                </Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={
            <Text style={{ color: c.muted }}>
              {view
                ? uiText("Scrivi il primo messaggio.")
                : error || uiText("Caricamento…")}
            </Text>
          }
        />
        {!!(error || notice || draft.error) && (
          <Text
            accessibilityRole="alert"
            style={{ color: c.text, paddingHorizontal: 12 }}
          >
            {error || notice || draft.error}
          </Text>
        )}
        {selected && (
          <View style={{ padding: 8, gap: 4 }}>
            <Text numberOfLines={1} style={{ color: c.muted }}>
              {selected.text || uiText("Allegato")}
            </Text>
            <Action
              label={uiText("Rispondi con citazione")}
              onPress={() => {
                draft.edit({ quoteId: selected.id });
                setSelected(null);
                composer.current?.focus();
              }}
            />
            <Action
              label={uiText("Chiudi")}
              onPress={() => setSelected(null)}
            />
          </View>
        )}
        <View
          style={{
            borderTopWidth: 1,
            borderColor: c.line,
            padding: 10,
            gap: 6,
          }}
        >
          {!!quoteId && !quote && (
            <Action
              label={uiText("Citazione non disponibile · Rimuovi")}
              onPress={() => draft.edit({ quoteId: undefined })}
            />
          )}
          {quote && (
            <Action
              label={uiText("Rimuovi citazione · {0}", String(quote.name))}
              onPress={() => draft.edit({ quoteId: undefined })}
            />
          )}
          {picking && (
            <Attachments
              files={files}
              onChange={(files) => draft.edit({ files })}
              disabled={disabled}
            />
          )}
          <PendingStrip commands={commands} />
          <View
            style={{
              flexDirection: compactWriting ? "row" : "column",
              gap: 3,
              alignItems: compactWriting ? "center" : "stretch",
            }}
          >
            <TextInput
              disableFullscreenUI
              ref={composer}
              accessibilityLabel={uiText("Messaggio privato")}
              placeholder={uiText("Scrivi a {0}…", String(name))}
              placeholderTextColor={c.muted}
              multiline
              maxLength={12000}
              value={text}
              editable={!disabled}
              onChangeText={(text) => draft.edit({ text })}
              style={{
                ...(compactWriting ? { flex: 1, minWidth: 0 } : {}),
                minHeight: 46,
                maxHeight: Math.min(120, height * 0.2),
                fontSize: 17,
                color: c.text,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: c.field,
                borderWidth: 1,
                borderColor: c.controlLine,
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
                accessibilityLabel={
                  picking
                    ? uiText("Chiudi allegati")
                    : uiText("Allega file o foto")
                }
                onPress={() => setPicking(!picking)}
                style={{
                  minWidth: 48,
                  minHeight: 48,
                  flexDirection: "row",
                  gap: 5,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <StudioIcon name="attach" color={c.muted} />
                {files.length > 0 && (
                  <Text style={{ color: c.muted }}>{files.length}</Text>
                )}
              </Pressable>
              <Action
                icon="send"
                label={uiText("Invia")}
                primary
                disabled={
                  disabled ||
                  (!!quoteId && !quote) ||
                  (!text.trim() && !files.length)
                }
                onPress={() =>
                  void draft.submit(commands.send, {
                    kind: "direct",
                    text: text.trim(),
                    quoteId: quote?.id,
                    files,
                    label: "Messaggio privato a " + name,
                  })
                }
              />
            </View>
          </View>
        </View>
      </View>
      {preview && previewFile && (
        <Panel title={previewFile.filename} onClose={() => setPreview(null)}>
          <ScrollView contentContainerStyle={{ gap: 9 }}>
            <AttachmentPreview
              request={request}
              path={path + "/files/" + preview.fileId}
            />
            <Action
              label={uiText("Vai al messaggio")}
              onPress={() => {
                const id = preview.messageId;
                setPreview(null);
                jump(id);
              }}
            />
          </ScrollView>
        </Panel>
      )}
      <Modal
        visible={sheet || !!profile}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setSheet(false);
          setProfile(null);
        }}
      >
        <ScrollView
          contentContainerStyle={{
            backgroundColor: c.bg,
            flexGrow: 1,
            padding: 22,
            gap: 12,
          }}
        >
          <Action
            label={uiText("Chiudi")}
            onPress={() => {
              setSheet(false);
              setProfile(null);
            }}
          />
          {profile ? (
            <>
              <Text style={{ color: c.text, fontSize: 24 }}>
                {profile.name}
              </Text>
              <Text selectable style={{ color: c.text }}>
                {profile.email}
              </Text>
              {profile.phone && (
                <Text selectable style={{ color: c.text }}>
                  {profile.phone}
                </Text>
              )}
            </>
          ) : (
            view && (
              <>
                <Text
                  accessibilityRole="header"
                  style={{ color: c.text, fontSize: 23 }}
                >
                  {uiText("Il tuo riepilogo")}
                </Text>
                <Text style={{ color: c.muted }}>
                  {uiText(
                    "Con il consenso di entrambi, ciascuno può chiedere a Emme un riepilogo privato dell’intera conversazione.",
                  )}
                </Text>
                <Action
                  label={
                    view.consent
                      ? uiText("Ritira il mio consenso")
                      : uiText("Consenti i riepiloghi")
                  }
                  disabled={working}
                  onPress={() =>
                    Alert.alert(
                      uiText("Riepiloghi con Emme"),
                      view.consent
                        ? uiText("Vuoi ritirare il tuo consenso?")
                        : uiText(
                            "Con il consenso di entrambi la conversazione potrà essere elaborata per i vostri riepiloghi personali.",
                          ),
                      [
                        { text: uiText("Annulla"), style: "cancel" },
                        {
                          text: uiText("Conferma"),
                          onPress: () => void control("consent"),
                        },
                      ],
                    )
                  }
                />
                <Text style={{ color: c.muted }}>
                  {view.peerConsent
                    ? uiText("{0} ha dato il consenso.", String(name))
                    : uiText("Il consenso di {0} manca.", String(name))}
                </Text>
                <Action
                  label={uiText("Riassumi per me")}
                  disabled={
                    working ||
                    !view.consent ||
                    !view.peerConsent ||
                    !view.messages.length
                  }
                  onPress={() => void control("recap")}
                />
                {view.recaps.map((r) => (
                  <View key={r.id} style={{ gap: 6 }}>
                    <Text selectable style={{ color: c.text }}>
                      {r.text}
                    </Text>
                    {r.sourceIds.map((m, i) => (
                      <Action
                        key={m}
                        label={uiText("Messaggio originale {0}", String(i + 1))}
                        onPress={() => {
                          setSheet(false);
                          jump(m);
                        }}
                      />
                    ))}
                  </View>
                ))}
                {!!notice && (
                  <Text accessibilityRole="alert" style={{ color: c.text }}>
                    {notice}
                  </Text>
                )}
              </>
            )
          )}
        </ScrollView>
      </Modal>
    </ChatViewport>
  );
}
const viewConfig = { itemVisiblePercentThreshold: 60, minimumViewTime: 350 };
