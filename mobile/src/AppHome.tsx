import { customSpaceAssistantLabels } from "../../src/shared/connection-name";
import { useUiLanguage } from "./i18n";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import type { ConversationDirectoryEntry } from "../../src/contracts/conversation-reading";
import type { DirectEntry } from "../../src/contracts/direct-chat";
import type { PersonalContacts } from "../../src/contracts/v1";
import type { AgendaView } from "../../src/contracts/agenda";
import type { Identity } from "./session";
import { post, problem, type NativeRequest } from "./api";
import { Action, Field, usePalette } from "./ui";
import { useResource } from "./useResource";
import { ChoiceStrip } from "./workspace/ToolLayout";
import { WorkspaceScreen } from "./workspace/WorkspaceScreen";
import { CreateWorkspaceScreen } from "./workspace/CreateWorkspaceScreen";
import { DirectScreen } from "./DirectScreen";
import { AccountSettings } from "./AccountSettings";
import { AgendaScreen, agendaPath, type AgendaStart } from "./AgendaScreen";
import { useAppearance } from "./appearance";
import {
  AppShell,
  HomeAvatar,
  HomeControl,
  ShellHeading,
  photoPath,
} from "./AppShell";
import { StudioIcon } from "./StudioIcon";
import type { PhotoDirectory } from "../../src/contracts/identity-photos";
import type { AssistantSettings } from "../../src/contracts/assistant-settings";
import type { personalHomeSchema } from "../../src/contracts/v1";
import type { z } from "zod";
import { PersonalScreen } from "./PersonalScreen";
import { IncomingInvitations } from "./IncomingInvitations";
import { usePushNavigation } from "./notifications/NativePush";

type Route =
  | { kind: "create"; contact?: { id: string; name: string } }
  | { kind: "home" | "contacts" | "settings" }
  | {
      kind: "personal";
      start?: "chat" | "documents" | "reminders" | "assistant";
      thread?: string;
    }
  | { kind: "agenda"; start?: AgendaStart }
  | { kind: "workspace"; id: string; name: string; anchor?: string }
  | { kind: "direct"; id: string; name: string };
export type HomeProps = {
  request: NativeRequest;
  origin: string;
  user: Identity;
  onLogout: () => void;
};
export function AppHome(props: HomeProps) {
  const [route, go] = useState<Route>({ kind: "home" });
  const [agendaVisit, setAgendaVisit] = useState(0);
  const home = useCallback(() => go({ kind: "home" }), []);
  const { request, user, origin } = props;
  const rooms = useResource<{ workspaces: ConversationDirectoryEntry[] }>(
    request,
    "/api/v1/workspaces",
    20000,
  );
  const photos = useResource<PhotoDirectory>(
    request,
    "/api/v1/identity-photos",
    60000,
  );
  const tools = useRef<((section: string) => void) | null>(null);
  const registerWorkspaceTools = useCallback(
    (open: ((section: string) => void) | null) => {
      tools.current = open;
    },
    [],
  );

  usePushNavigation(request, origin, (id) =>
    go({ kind: "workspace", id, name: "Spazio" }),
  );
  const shared = { request, origin, actorId: user.id, onBack: home };
  useEffect(() => {
    if (route.kind === "home") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      home();
      return true;
    });
    return () => sub.remove();
  }, [route.kind, home]);
  const open = (id: string, name: string) =>
    go({ kind: "workspace", id, name });
  const incoming = (
    <IncomingInvitations
      request={request}
      refreshSpaces={rooms.refresh}
      onAccepted={(id, name) => {
        rooms.refresh();
        open(id, name);
      }}
    />
  );
  function screen(toggle: () => void, showMenu: boolean) {
    switch (route.kind) {
      case "workspace":
        return (
          <WorkspaceScreen
            key={route.id}
            {...shared}
            onOpenNavigation={showMenu ? toggle : undefined}
            registerWorkspaceTools={registerWorkspaceTools}
            incomingInvitations={incoming}
            email={user.email}
            name={route.name}
            workspaceId={route.id}
            openWorkspace={open}
            initialMessageId={route.anchor}
          />
        );
      case "create":
        return (
          <CreateWorkspaceScreen
            {...shared}
            initialContact={route.contact}
            onOpenNavigation={showMenu ? toggle : undefined}
            onCreated={(room) => {
              rooms.refresh();
              open(room.id, room.name);
            }}
          />
        );
      case "direct":
        return (
          <DirectScreen
            {...shared}
            id={route.id}
            name={route.name}
            onCreate={(contact) => go({ kind: "create", contact })}
          />
        );
      case "contacts":
        return (
          <Contacts
            request={request}
            actorId={user.id}
            onBack={home}
            onOpen={(id, name) => go({ kind: "direct", id, name })}
          />
        );
      case "settings":
        return <AccountSettings {...props} onBack={home} />;
      case "agenda":
        return (
          <AgendaScreen
            key={`${agendaVisit}:${route.start?.kind ?? "today"}`}
            {...props}
            onOpenNavigation={showMenu ? toggle : undefined}
            start={route.start}
            open={open}
          />
        );
      case "personal":
        return (
          <PersonalScreen
            onOpenNavigation={showMenu ? toggle : undefined}
            key={(route.start ?? "chat") + (route.thread ?? "")}
            {...props}
            start={route.start}
            initialThreadId={route.thread}
            onBack={home}
          />
        );
      default:
        return (
          <Directory
            {...props}
            rooms={rooms}
            photos={photos.value}
            incoming={incoming}
            onMenu={showMenu ? toggle : undefined}
            go={go}
          />
        );
    }
  }
  return (
    <AppShell
      request={request}
      user={user}
      rooms={rooms.value?.workspaces ?? []}
      roomsError={rooms.error}
      retryRooms={rooms.refresh}
      photos={photos.value}
      section={
        route.kind === "personal" && route.start === "assistant"
          ? "assistant"
          : route.kind
      }
      workspaceId={route.kind === "workspace" ? route.id : undefined}
      toHome={home}
      toPersonal={() => go({ kind: "personal", start: "chat" })}
      toAssistant={() => {
        if (route.kind === "workspace" && tools.current)
          tools.current("Configura Emme");
        else go({ kind: "personal", start: "assistant" });
      }}
      toToday={() => {
        setAgendaVisit((visit) => visit + 1);
        go({ kind: "agenda" });
      }}
      toProfile={() => go({ kind: "settings" })}
      create={() => go({ kind: "create" })}
      openRoom={(room) => open(room.id, room.name)}
      openTool={(label) => tools.current?.(label)}
    >
      {screen}
    </AppShell>
  );
}

function Directory({
  request,
  user,
  go,
  rooms,
  photos,
  onMenu,
  incoming,
}: HomeProps & {
  go: (route: Route) => void;
  rooms: ReturnType<
    typeof useResource<{ workspaces: ConversationDirectoryEntry[] }>
  >;
  photos?: PhotoDirectory;
  onMenu?: () => void;
  incoming: React.ReactNode;
}) {
  const { t: uiText, locale } = useUiLanguage();
  const c = usePalette();
  const appearance = useAppearance();
  const today = useResource<AgendaView>(request, agendaPath(new Date()), 60000);
  const personal = useResource<z.infer<typeof personalHomeSchema>>(
    request,
    "/api/v1/personal-space",
    60000,
  );
  const assistant = useResource<AssistantSettings>(
    request,
    "/api/v1/assistant-settings",
  );
  const { width, fontScale } = useWindowDimensions();
  const customAssistantLabels = useMemo(
    () => customSpaceAssistantLabels(assistant.value),
    [assistant.value],
  );
  const wide = width > 760;
  const [showAll, setShowAll] = useState(false);
  const title = {
    color: c.heading,
    fontSize: 21,
    fontWeight: "600" as const,
    letterSpacing: -0.45,
  };
  const divider = {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: c.line,
  };
  const expanded = appearance.settings.showToday !== false;

  const direct = useResource<DirectEntry[]>(
    request,
    "/api/v1/direct-chats",
    20000,
  );
  const [issue, setIssue] = useState(""),
    [busy, setBusy] = useState(false);
  const entries = [
    ...(rooms.value?.workspaces ?? []).map((row) => ({
      ...row,
      kind: "workspace" as const,
    })),
    ...(direct.value ?? []).map((row) => ({ ...row, kind: "direct" as const })),
  ].sort(
    (a, b) =>
      Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) ||
      a.id.localeCompare(b.id),
  );
  const refresh = () => {
    rooms.refresh();
    direct.refresh();
    today.refresh();
    personal.refresh();
    assistant.refresh();
  };
  async function openAgenda(kind: AgendaStart["kind"]) {
    if (busy) return;
    setBusy(true);
    setIssue("");
    try {
      const archive = await request<{ id: string }>(
        "/api/v1/personal-space",
        post({ expectedActorId: user.id }),
      );
      go({ kind: "agenda", start: { target: archive.id, kind } });
    } catch (error) {
      setIssue(problem(error, uiText));
    } finally {
      setBusy(false);
    }
  }
  const shortcuts = [
    ["chat", "Tu ed Emme", "mark"],
    ["documents", "Documenti", "files"],
    ["reminders", "Promemoria", "bell"],
  ] as const;
  const [agendaFilter, setAgendaFilter] = useState("Tutto");
  const agendaItems = (today.value?.items ?? []).filter(
    (i) =>
      agendaFilter === "Tutto" || i.personal === (agendaFilter === "Solo io"),
  );
  const when = (at: string) =>
    new Date(at).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
      contentContainerStyle={{
        paddingHorizontal: wide ? 26 : 14,
        paddingBottom: 32,
        maxWidth: 1050,
        width: "100%",
        alignSelf: "center",
        backgroundColor: c.bg,
      }}
    >
      <ShellHeading
        title={uiText("I tuoi spazi")}
        menu={onMenu}
        action={
          width / fontScale >= 345 ? (
            <Action
              primary
              icon="plus"
              label={uiText("Nuovo spazio")}
              onPress={() => go({ kind: "create" })}
            />
          ) : (
            <HomeControl
              icon="plus"
              iconOnly
              label={uiText("Nuovo spazio")}
              onPress={() => go({ kind: "create" })}
            />
          )
        }
      />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          columnGap: 8,
          paddingTop: 6,
        }}
      >
        <Text accessibilityRole="header" style={title}>
          {uiText("Conversazioni")}
        </Text>
        <HomeControl
          label={uiText("Scrivi a un contatto")}
          icon="people"
          onPress={() => go({ kind: "contacts" })}
        />
      </View>
      {incoming}
      {entries.map((row) => {
        const assistantLabel =
          row.kind === "workspace"
            ? customAssistantLabels.get(row.id)
            : undefined;
        const path =
          row.kind === "workspace"
            ? photoPath(photos?.rooms[row.id], "workspace", row.id)
            : row.photoVersion
              ? "/api/v1/direct-chats/" +
                row.id +
                "/photo?v=" +
                row.photoVersion
              : undefined;
        return (
          <View
            key={row.kind + row.id}
            style={{
              borderTopWidth: StyleSheet.hairlineWidth,
              borderColor: c.line,
              paddingVertical: 5,
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => go({ kind: row.kind, id: row.id, name: row.name })}
              style={({ pressed }) => ({
                minHeight: 62,
                paddingVertical: 8,
                paddingHorizontal: 3,
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 9,
                backgroundColor: pressed ? c.panel : "transparent",
                borderRadius: 5,
              })}
            >
              <HomeAvatar
                room={row.kind === "workspace"}
                request={request}
                name={row.name}
                path={path}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <View
                  style={{
                    flexDirection: "row",
                    gap: 5,
                    alignItems: "flex-start",
                    flexWrap: fontScale > 1.3 ? "wrap" : "nowrap",
                  }}
                >
                  <Text
                    style={{
                      flexGrow: 1,
                      flexShrink: 1,
                      color: c.text,
                      fontWeight: "700",
                      fontSize: 17,
                    }}
                  >
                    {row.name}
                  </Text>
                  {!!row.unreadCount && (
                    <Text
                      accessibilityLabel={uiText(
                        "{0} messaggi non letti",
                        String(row.unreadCount),
                      )}
                      style={{
                        color: c.accent,
                        fontSize: 13,
                        fontWeight: "700",
                      }}
                    >
                      {row.unreadCount}
                      {uiText(" non letti")}
                    </Text>
                  )}
                </View>
                <Text style={{ color: c.muted, fontSize: 13 }}>
                  {row.kind === "workspace"
                    ? uiText("Spazio")
                    : uiText("Chat privata")}
                  {assistantLabel && " · " + assistantLabel}
                </Text>
                {!!row.preview && (
                  <Text
                    numberOfLines={2}
                    style={{ color: c.muted, fontSize: 14 }}
                  >
                    {row.preview}
                  </Text>
                )}
              </View>
              {wide && (
                <View style={{ paddingTop: 4 }}>
                  <StudioIcon name="arrow" size={16} color={c.muted} />
                </View>
              )}
            </Pressable>
            {row.kind === "workspace" &&
              (row.firstMentionId || row.firstRequestId) && (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 4,
                    paddingLeft: 42,
                  }}
                >
                  {!!row.firstMentionId && (
                    <HomeControl
                      label={uiText("@ {0} menzioni", String(row.mentionCount))}
                      onPress={() =>
                        go({
                          kind: "workspace",
                          id: row.id,
                          name: row.name,
                          anchor: row.firstMentionId!,
                        })
                      }
                    />
                  )}
                  {!!row.firstRequestId && (
                    <HomeControl
                      label={uiText(
                        "Da decidere · {0}",
                        String(row.requestCount),
                      )}
                      onPress={() =>
                        go({
                          kind: "workspace",
                          id: row.id,
                          name: row.name,
                          anchor: row.firstRequestId!,
                        })
                      }
                    />
                  )}
                </View>
              )}
          </View>
        );
      })}
      {!entries.length && !rooms.error && !direct.error && (
        <Text style={{ color: c.muted, paddingVertical: 12 }}>
          {rooms.value && direct.value
            ? uiText("Nessuna conversazione. Apri un invito o crea uno spazio.")
            : uiText("Caricamento conversazioni…")}
        </Text>
      )}
      <View
        style={{
          ...divider,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingVertical: 10,
          gap: 2,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <Text accessibilityRole="header" style={title}>
              {uiText("Personale")}
            </Text>
            <Text style={{ color: c.muted, fontSize: 14 }}>
              {uiText("Solo io")}
            </Text>
          </View>
          <HomeControl
            label={uiText("Configura Emme")}
            icon="settings"
            onPress={() => go({ kind: "personal", start: "assistant" })}
          />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 2 }}>
          {shortcuts.map(([start, label, icon]) => (
            <HomeControl
              key={start}
              compact
              label={uiText(label)}
              icon={icon}
              onPress={() => go({ kind: "personal", start })}
            />
          ))}
        </View>
        {personal.value?.readyResearch && (
          <HomeControl
            label={uiText("Ricerca pronta · Apri in Tu ed Emme")}
            onPress={() =>
              go({
                kind: "personal",
                start: "chat",
                thread: personal.value!.readyResearch!.thread,
              })
            }
          />
        )}
        {!!personal.value?.reminders.length && (
          <View style={{ gap: 2, paddingTop: 7 }}>
            <Text style={{ color: c.muted, fontWeight: "600", fontSize: 14 }}>
              {uiText("Prossimi promemoria")}
            </Text>
            {personal.value.reminders.map((r) => (
              <Text key={r.id} style={{ color: c.text, fontSize: 14 }}>
                {new Date(r.nextRemindAt).toLocaleDateString(locale, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}{" "}
                · {when(r.nextRemindAt)} · {r.content}
              </Text>
            ))}
          </View>
        )}
      </View>
      <View style={{ paddingVertical: 10, gap: 3 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 3,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              expanded
                ? uiText("Nascondi agenda di oggi")
                : uiText("Mostra agenda di oggi")
            }
            accessibilityState={{ expanded }}
            onPress={() =>
              appearance.save({ ...appearance.settings, showToday: !expanded })
            }
            style={{
              flexDirection: "row",
              alignItems: "center",
              minHeight: 48,
              gap: 9,
            }}
          >
            <Text style={title}>{uiText("Oggi")}</Text>
            <Text style={{ color: c.muted, fontSize: 19, fontWeight: "600" }}>
              {expanded ? "−" : "+"}
            </Text>
          </Pressable>
          <HomeControl
            icon="calendar"
            label={
              today.value?.hasLinkedCalendar
                ? uiText("Calendari collegati")
                : today.value?.hasLinkedCalendar === false
                  ? uiText("Collega calendario")
                  : uiText("Calendari esterni")
            }
            disabled={busy}
            onPress={() => void openAgenda("calendar")}
          />
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            columnGap: 2,
          }}
        >
          {(
            [
              ["Calendario", "Calendario", "calendar", "calendar"],
              ["Promemoria", "Nuovo promemoria", "plus", "reminder"],
              ["Appuntamento", "Nuovo appuntamento", "plus", "event"],
            ] as const
          ).map(([label, action, icon, kind]) => (
            <HomeControl
              key={kind}
              compact
              label={uiText(label)}
              accessibilityLabel={uiText(action)}
              icon={icon}
              disabled={busy}
              onPress={() => {
                if (kind === "calendar") go({ kind: "agenda" });
                else void openAgenda(kind);
              }}
            />
          ))}
        </View>
        {expanded && (
          <View style={{ gap: 3, paddingBottom: 6 }}>
            {(!!today.value?.items.length || agendaFilter !== "Tutto") && (
              <ChoiceStrip
                label={uiText("Mostra impegni")}
                choices={["Tutto", "Solo io", "Spazi"]}
                value={agendaFilter}
                onSelect={setAgendaFilter}
              />
            )}
            {agendaItems.slice(0, showAll ? undefined : 3).map((item) => (
              <Pressable
                key={item.id + item.at}
                accessibilityRole="button"
                onPress={() => go({ kind: "agenda" })}
                style={{
                  flexDirection: "row",
                  gap: 12,
                  paddingVertical: 5,
                  minHeight: 48,
                }}
              >
                <Text
                  style={{ color: c.accent, fontSize: 15, fontWeight: "700" }}
                >
                  {when(item.at)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 16 }}>
                    {item.title}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 13 }}>
                    {item.personal ? uiText("Solo io") : item.workspaceName}
                    {item.rsvp === "pending" ? uiText(" · Da confermare") : ""}
                  </Text>
                </View>
              </Pressable>
            ))}
            {!agendaItems.length && (
              <Text style={{ color: c.muted, fontSize: 15 }}>
                {today.error ??
                  (today.value
                    ? uiText("Nessun impegno per questa giornata.")
                    : uiText("Caricamento agenda…"))}
              </Text>
            )}
            {agendaItems.length > 3 && (
              <HomeControl
                label={
                  showAll
                    ? uiText("Mostra meno")
                    : uiText("Mostra tutti gli impegni")
                }
                onPress={() => setShowAll((v) => !v)}
              />
            )}
            {(today.value?.previous.length ?? 0) > 0 && (
              <HomeControl
                label={uiText("Promemoria precedenti")}
                onPress={() => go({ kind: "agenda" })}
              />
            )}
            {(today.value?.offers.length ?? 0) > 0 && (
              <HomeControl
                label={uiText(
                  "In attesa di te · {0}",
                  String(today.value!.offers.length),
                )}
                onPress={() => go({ kind: "agenda" })}
              />
            )}
          </View>
        )}
      </View>
      {[rooms.error, direct.error, personal.error, issue]
        .filter(Boolean)
        .map((message, i) => (
          <Text accessibilityRole="alert" style={{ color: c.text }} key={i}>
            {message}
          </Text>
        ))}
      {(rooms.error || direct.error || personal.error || today.error) && (
        <HomeControl label={uiText("Riprova")} onPress={refresh} />
      )}
    </ScrollView>
  );
}
function Contacts({
  request,
  actorId,
  onBack,
  onOpen,
}: {
  request: NativeRequest;
  actorId: string;
  onBack: () => void;
  onOpen: (id: string, name: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const data = useResource<PersonalContacts>(
    request,
    "/api/v1/contacts?q=" + encodeURIComponent(q) + "&offset=" + offset,
  );
  const c = usePalette();
  async function open(id: string, name: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await request<{ id: string }>(
        "/api/v1/direct-chats",
        post({ expectedActorId: actorId, contactId: id }),
      );
      onOpen(r.id, name);
    } catch (e) {
      setError(problem(e, uiText));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 18, gap: 12 }}
    >
      <Action label={uiText("‹ Home")} onPress={onBack} />
      <Field
        label={uiText("Cerca nei tuoi contatti")}
        value={q}
        onChangeText={(s) => {
          setOffset(0);
          setQ(s);
        }}
      />
      {data.value?.contacts.map((a) => (
        <Action
          key={a.id}
          disabled={busy || a.nameAmbiguous}
          label={a.name + (a.nameAmbiguous ? uiText(" · omonimo") : "")}
          onPress={() => void open(a.id, a.name)}
        />
      ))}
      {data.value?.contacts.length === 0 && (
        <Text style={{ color: c.muted }}>
          {uiText("Nessun contatto trovato.")}
        </Text>
      )}
      {offset > 0 && (
        <Action
          label={uiText("Precedenti")}
          onPress={() => setOffset(Math.max(0, offset - 30))}
        />
      )}
      {data.value?.nextOffset != null && (
        <Action
          label={uiText("Altri contatti")}
          onPress={() => setOffset(data.value!.nextOffset!)}
        />
      )}
      {!!(error || data.error) && (
        <Text accessibilityRole="alert" style={{ color: c.text }}>
          {error || data.error}
        </Text>
      )}
    </ScrollView>
  );
}
