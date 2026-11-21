import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { PhotoDirectory } from "../../../src/contracts/identity-photos";
import type { ActiveWorkPresence } from "../../../src/contracts/active-work";
import type { AssistantSettings } from "../../../src/contracts/assistant-settings";
import type { NativeRequest } from "../api";
import { useAppearance } from "../appearance";
import { StudioIcon, type StudioIconName } from "../StudioIcon";
import { HomeAvatar, photoPath } from "../AppShell";
import { useResource } from "../useResource";
import { Action, usePalette } from "../ui";
import { Panel } from "./SharedFiles";
import type { Tool } from "./WorkspaceTools";

function HeaderButton({
  label,
  icon,
  caption,
  selected,
  underline,
  onPress,
  signal,
}: {
  label: string;
  icon?: StudioIconName;
  caption?: string;
  selected?: boolean;
  underline?: boolean;
  onPress: () => void;
  signal?: "unavailable" | "attention";
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? {} : { selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: caption ? 8 : 0,
        flexDirection: "row",
        gap: 4,
        borderRadius: 8,
        backgroundColor:
          selected && !underline
            ? p.accentSoft
            : pressed
              ? p.panel
              : "transparent",
      })}
    >
      {icon && (
        <StudioIcon
          name={icon}
          color={selected ? p.heading : p.text}
          size={icon === "menu" ? 25 : 21}
        />
      )}
      {caption && (
        <Text
          numberOfLines={1}
          style={{
            color: selected ? p.heading : p.muted,
            fontWeight: "600",
            fontSize: 14.5,
          }}
        >
          {caption}
        </Text>
      )}
      {selected && underline && (
        <View
          accessible={false}
          style={{
            position: "absolute",
            bottom: 3,
            left: 8,
            right: 8,
            height: 2,
            backgroundColor: p.heading,
          }}
        />
      )}
      {signal && (
        <View
          accessibilityElementsHidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            borderWidth: 1.5,
            borderColor: p.muted,
            backgroundColor: signal === "attention" ? p.muted : "transparent",
          }}
        />
      )}
    </Pressable>
  );
}

export function ChatHeader({
  snapshot,
  photos,
  name,
  request,
  path,
  assistant,
  shared,
  canInvite,
  openNavigation,
  showChat,
  showShared,
  onTool,
}: {
  snapshot?: Snapshot;
  photos?: PhotoDirectory;
  name: string;
  request: NativeRequest;
  path: string;
  assistant?: AssistantSettings;
  shared: boolean;
  canInvite: boolean;
  openNavigation?: () => void;
  showChat: () => void;
  showShared: () => void;
  onTool: (tool: Tool, item?: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette(),
    appearance = useAppearance(),
    { width, height, fontScale } = useWindowDimensions();
  const room = snapshot?.workspace;
  const compact = width < 640 || (height < 500 && width <= 1050);
  const narrow = width < 351 || fontScale > 1.4;
  const active = snapshot?.members.filter((m) => m.active) ?? [];
  const [activity, setActivity] = useState(false);
  const work = useResource<ActiveWorkPresence>(
    request,
    path + "/active-work-presence?revision=" + (room?.revision ?? 0),
  );
  const running = work.value?.ongoing.find((item) => item.phase !== "paused");
  const unavailable =
    !!assistant &&
    (assistant.needsReconfirmation ||
      !assistant.connections.find((c) => c.id === assistant.connectionId)
        ?.configured);
  const reading = snapshot?.interpretations.some((i) =>
    ["running", "queued", "failed", "stale"].includes(i.status),
  );
  const goal = snapshot?.goals.find((g) => g.current_primary);
  function route(t: Tool, id?: string) {
    setActivity(false);
    onTool(t, id);
  }
  const tabs = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      <HeaderButton
        label={uiText("Chat")}
        caption="Chat"
        underline={compact}
        selected={!shared}
        onPress={showChat}
      />
      <HeaderButton
        label={uiText("Condivisi")}
        caption={uiText("Condivisi")}
        underline={compact}
        selected={shared}
        onPress={showShared}
      />
    </View>
  );
  const tools = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      <HeaderButton
        label={uiText("Attività dello spazio")}
        icon="mark"
        caption={compact && !narrow ? uiText("Attività") : undefined}
        signal={
          unavailable
            ? "unavailable"
            : running || reading || work.error
              ? "attention"
              : undefined
        }
        onPress={() => setActivity(true)}
      />
      <HeaderButton
        label={uiText("Notifiche di questo spazio")}
        icon="bell"
        onPress={() => onTool("Notifiche")}
      />
    </View>
  );
  const photo = room && photoPath(photos?.rooms[room.id], "workspace", room.id);
  return (
    <>
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 3,
          borderBottomColor: p.line,
          borderBottomWidth: 1,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          {openNavigation && (
            <HeaderButton
              icon="menu"
              label={uiText("Apri navigazione")}
              onPress={openNavigation}
            />
          )}
          {photo && (
            <HomeAvatar
              name={name}
              room
              size={28}
              request={request}
              path={photo}
            />
          )}
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              flex: 1,
              minWidth: 0,
              marginLeft: 2,
              color: p.heading,
              fontWeight: "600",
              fontSize: 19.5,
              letterSpacing: -0.55,
            }}
          >
            {room?.name ?? name}
          </Text>
          {!compact && snapshot && (
            <>
              {tabs}
              {tools}
            </>
          )}
          {snapshot && (
            <>
              <HeaderButton
                label={uiText(
                  active.length === 1 ? "{0} persona" : "{0} persone",
                  active.length,
                )}
                icon={narrow ? "people" : undefined}
                caption={
                  narrow
                    ? undefined
                    : uiText(
                        active.length === 1 ? "{0} persona" : "{0} persone",
                        active.length,
                      )
                }
                onPress={() => onTool("Persone")}
              />
              {canInvite && (
                <HeaderButton
                  label={uiText("Invita una persona")}
                  icon="invite"
                  onPress={() => onTool("Invita una persona")}
                />
              )}
              <HeaderButton
                label={
                  appearance.dark
                    ? uiText("Attiva tema chiaro")
                    : uiText("Attiva tema scuro")
                }
                icon="theme"
                onPress={() =>
                  appearance.save({
                    ...appearance.settings,
                    mode: appearance.dark ? "light" : "dark",
                  })
                }
              />
            </>
          )}
        </View>
        {compact && snapshot && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            {tabs}
            {tools}
          </View>
        )}
      </View>
      {goal && !compact && (
        <Action
          icon="goal"
          label={goal.content}
          variant="quiet"
          onPress={() => onTool("Direzione")}
        />
      )}
      {activity && (
        <Panel
          title={uiText("Attività dello spazio")}
          onClose={() => setActivity(false)}
        >
          <ScrollView contentContainerStyle={{ gap: 8 }}>
            {unavailable && (
              <Text style={{ color: p.muted }}>
                {assistant?.displayName ?? uiText("Emme")}
                {uiText(
                  " non disponibile. Il servizio AI non è configurato. Puoi continuare a scrivere al gruppo.",
                )}
              </Text>
            )}
            {goal && (
              <Action
                icon="goal"
                label={goal.content}
                variant="quiet"
                onPress={() => route("Direzione")}
              />
            )}
            {running && (
              <Action
                icon="mark"
                label={running.objective}
                onPress={() => route("Attività di Emme", running.id)}
              />
            )}
            {reading && (
              <Action
                label={uiText("Verifica lettura di Emme")}
                variant="quiet"
                onPress={() => route("Contesto")}
              />
            )}
            <Action
              icon="branch"
              label={uiText("Attività e argomenti")}
              variant="quiet"
              onPress={() => route("Attività e argomenti")}
            />
            <Action
              icon="mark"
              label={uiText("Attività di Emme")}
              variant="quiet"
              onPress={() => route("Attività di Emme")}
            />
          </ScrollView>
        </Panel>
      )}
    </>
  );
}
