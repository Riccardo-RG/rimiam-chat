import { useUiLanguage } from "./i18n";
import React, { type ComponentProps, type ReactNode, useState } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { destinations, tools } from "../../src/shared/workspace-navigation";
import type { PhotoDirectory } from "../../src/contracts/identity-photos";
import { initials } from "../../src/shared/conversation-presentation";
import { StudioIcon } from "./StudioIcon";
import { useKeyboardVisible } from "./useKeyboardVisible";
import { usePalette } from "./ui";
import { useAppearance } from "./appearance";
import { ProtectedImage } from "./ProtectedImage";
import type { NativeRequest } from "./api";
import type { Identity } from "./session";
import brandIcon from "../assets/icon.png";

type Icon = ComponentProps<typeof StudioIcon>["name"];
type Room = { id: string; name: string };

export function HomeControl({
  label,
  accessibilityLabel = label,
  icon,
  onPress,
  iconOnly,
  selected,
  disabled,
  expanded,
  stretch = false,
  compact = false,
}: {
  label: string;
  accessibilityLabel?: string;
  icon?: Icon;
  onPress: () => void;
  iconOnly?: boolean;
  selected?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  stretch?: boolean;
  compact?: boolean;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled, expanded }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: Platform.OS === "android" ? 48 : 44,
        minWidth: Platform.OS === "android" ? 48 : 44,
        maxWidth: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: iconOnly ? "center" : "flex-start",
        alignSelf: stretch ? "stretch" : undefined,
        gap: compact ? 5 : 7,
        paddingVertical: 5,
        paddingHorizontal: compact ? 3 : 6,
        borderRadius: 8,
        backgroundColor: selected
          ? c.accentSoft
          : pressed
            ? c.panel
            : "transparent",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {icon && (
        <StudioIcon
          name={icon}
          size={icon === "menu" ? 25 : iconOnly ? 20 : 16}
          color={selected ? c.accent : c.muted}
        />
      )}
      {!iconOnly && (
        <Text
          style={{
            flexShrink: 1,
            color: selected ? c.text : c.muted,
            fontSize: 14,
            fontWeight: selected ? "700" : "600",
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function ShellHeading({
  title,
  menu,
  action,
}: {
  title: string;
  menu?: () => void;
  action?: ReactNode;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        minHeight: 58,
        borderBottomWidth: 1,
        borderColor: c.line,
        paddingVertical: 3,
      }}
    >
      {menu && (
        <HomeControl
          icon="menu"
          iconOnly
          label={uiText("Apri navigazione")}
          onPress={menu}
        />
      )}
      <Text
        accessibilityRole="header"
        style={{
          flex: 1,
          color: c.heading,
          fontWeight: "700",
          fontSize: 22,
          letterSpacing: -0.6,
        }}
      >
        {title}
      </Text>
      {action}
    </View>
  );
}

export function photoPath(
  record: { present: boolean; version: number } | undefined,
  field: "workspace" | "person",
  id: string,
) {
  return record?.present
    ? "/api/v1/identity-photos?image=1&v=" +
        record.version +
        "&" +
        field +
        "=" +
        encodeURIComponent(id)
    : undefined;
}

export function memberPhotoPath(
  photos: PhotoDirectory | undefined,
  workspaceId: string,
  personId: string,
) {
  const path = photoPath(photos?.members[personId], "person", personId);
  return path
    ? path + "&workspace=" + encodeURIComponent(workspaceId)
    : undefined;
}

export function HomeAvatar({
  request,
  name,
  path,
  room = false,
  size = 34,
}: {
  request: NativeRequest;
  name: string;
  path?: string;
  room?: boolean;
  size?: number;
}) {
  const c = usePalette();
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: room ? 7 : size / 2,
        borderWidth: room ? StyleSheet.hairlineWidth : 0,
        borderColor: c.line,
        backgroundColor: room ? c.bg : c.panel,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {room ? (
        <StudioIcon name="space" size={size * 0.55} color={c.heading} />
      ) : (
        <Text
          style={{
            color: c.heading,
            fontWeight: "700",
            fontSize: Math.max(11, size * 0.35),
          }}
        >
          {initials(name)}
        </Text>
      )}
      {path && (
        <ProtectedImage
          request={request}
          path={path}
          mediaType="image/jpeg"
          label={name}
          style={{
            position: "absolute",
            width: size,
            height: size,
            top: 0,
            left: 0,
          }}
        />
      )}
    </View>
  );
}

export function AppShell({
  children,
  rooms,
  user,
  photos,
  request,
  section,
  workspaceId,
  toHome,
  toPersonal,
  toAssistant,
  toToday,
  toProfile,
  create,
  openRoom,
  openTool,
  retryRooms,
  roomsError,
}: {
  children: (toggle: () => void, showMenu: boolean) => ReactNode;
  rooms: Room[];
  user: Identity;
  photos?: PhotoDirectory;
  request: NativeRequest;
  section: string;
  workspaceId?: string;
  toHome: () => void;
  toPersonal: () => void;
  toAssistant: () => void;
  toToday: () => void;
  toProfile: () => void;
  create: () => void;
  openRoom: (room: Room) => void;
  openTool: (section: string) => void;
  retryRooms: () => void;
  roomsError?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    appearance = useAppearance(),
    insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions(),
    compact = width <= 760;
  const typing = useKeyboardVisible();
  const keyboardNeedsWidth =
    typing &&
    height < 500 &&
    ["workspace", "direct", "personal"].includes(section);
  const [drawer, setDrawer] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [openTools, setOpenTools] = useState(false);
  const [lastCompact, setLastCompact] = useState(compact);
  if (lastCompact !== compact) {
    setLastCompact(compact);
    setDrawer(false);
  }
  const hide = () => (compact ? setDrawer(false) : setCollapsed(true));
  const toggle = () => (compact ? setDrawer(true) : setCollapsed((v) => !v));
  const follow = (action: () => void) => {
    setDrawer(false);
    action();
  };
  const railWidth = compact
    ? Math.min(292, Math.max(220, width * 0.83))
    : Math.min(236, Math.max(184, width * 0.2));
  function row(
    label: string,
    icon: Icon,
    action: () => void,
    selected = false,
  ) {
    return (
      <HomeControl
        key={label}
        label={uiText(label)}
        icon={icon}
        stretch
        selected={selected}
        onPress={() => follow(action)}
      />
    );
  }
  const navigation = (
    <View
      style={{
        width: railWidth,
        alignSelf: "stretch",
        flexShrink: 0,
        maxWidth: railWidth,
        backgroundColor: c.rail,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderColor: c.line,
        paddingHorizontal: 10,
        paddingTop: compact ? Math.max(12, insets.top) : 5,
        paddingBottom: compact ? Math.max(8, insets.bottom) : 5,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: 48,
          gap: 4,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uiText("RIMIAM — Home")}
          onPress={() => follow(toHome)}
          style={{
            minHeight: 44,
            minWidth: 44,
            flexShrink: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 4,
          }}
        >
          <Image
            source={brandIcon}
            accessible={false}
            style={{ width: 20, height: 20 }}
          />
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              fontSize: 22,
              color: c.text,
              fontWeight: "800",
              letterSpacing: -1.3,
            }}
          >
            {uiText("rimiam")}
          </Text>
        </Pressable>
        <HomeControl
          label={uiText("Chiudi navigazione")}
          icon="menu"
          iconOnly
          onPress={hide}
        />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: 8, gap: 1, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {row("I tuoi spazi", "home", toHome, section === "home")}
          </View>
          <HomeControl
            label={uiText("Nuovo spazio")}
            icon="plus"
            iconOnly
            onPress={() => follow(create)}
          />
        </View>
        <View
          style={{
            paddingLeft: 5,
            marginLeft: 9,
            borderLeftWidth: rooms.length ? StyleSheet.hairlineWidth : 0,
            borderColor: c.line,
          }}
        >
          {rooms.map((room) => (
            <Pressable
              key={room.id}
              accessibilityRole="button"
              accessibilityLabel={room.name}
              accessibilityState={{ selected: workspaceId === room.id }}
              onPress={() => follow(() => openRoom(room))}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                minHeight: 44,
                gap: 8,
                borderRadius: 7,
                paddingHorizontal: 8,
                backgroundColor:
                  workspaceId === room.id
                    ? c.accentSoft
                    : pressed
                      ? c.panel
                      : "transparent",
              })}
            >
              {photos?.rooms[room.id]?.present ? (
                <HomeAvatar
                  request={request}
                  name={room.name}
                  path={photoPath(photos.rooms[room.id], "workspace", room.id)}
                  room
                  size={19}
                />
              ) : (
                <StudioIcon name="space" size={16} color={c.muted} />
              )}
              <Text
                numberOfLines={2}
                style={{ flexShrink: 1, color: c.text, fontSize: 14 }}
              >
                {room.name}
              </Text>
            </Pressable>
          ))}
          {!!roomsError && (
            <HomeControl
              label={uiText("Ricarica spazi")}
              onPress={retryRooms}
            />
          )}
        </View>
        <View
          style={{
            marginVertical: 9,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: c.line,
          }}
        />
        {row("Tu ed Emme", "mark", toPersonal, section === "personal")}
        {row(
          "Configura Emme",
          "settings",
          toAssistant,
          section === "assistant",
        )}
        {row("Oggi", "today", toToday, section === "agenda")}
        {!!workspaceId && (
          <View style={{ marginTop: 12, gap: 2 }}>
            <Text
              style={{
                paddingHorizontal: 8,
                color: c.muted,
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              {uiText("In questo spazio")}
            </Text>
            <HomeControl
              label={uiText("Strumenti")}
              icon="settings"
              expanded={openTools}
              onPress={() => setOpenTools((v) => !v)}
            />
            {openTools &&
              tools.map((id) => {
                const [label, icon] = destinations[id];
                return row(label, icon, () => openTool(label));
              })}
          </View>
        )}
        {height > 620 && (
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              marginTop: "auto",
              paddingTop: 24,
              paddingBottom: 6,
              paddingHorizontal: 8,
              opacity: 0.25,
            }}
          >
            <StudioIcon name="mark" color={c.muted} size={36} />
          </View>
        )}
      </ScrollView>
      <View
        style={{
          borderColor: c.line,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingTop: 4,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uiText(
            "Account personale, {0}",
            String(user.name),
          )}
          onPress={() => follow(toProfile)}
          style={{
            flex: 1,
            minHeight: 48,
            flexDirection: "row",
            gap: 7,
            alignItems: "center",
          }}
        >
          <HomeAvatar
            name={user.name}
            size={28}
            request={request}
            path={photoPath(photos?.own, "person", user.id)}
          />
          <Text
            numberOfLines={2}
            style={{ flex: 1, fontSize: 13, color: c.text, fontWeight: "600" }}
          >
            {user.name}
          </Text>
        </Pressable>
        <HomeControl
          icon="theme"
          iconOnly
          label={
            appearance.dark
              ? uiText("Attiva tema chiaro")
              : uiText("Attiva tema scuro")
          }
          onPress={() =>
            appearance.save({
              ...appearance.settings,
              mode: appearance.dark ? "light" : "dark",
            })
          }
        />
      </View>
    </View>
  );
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.bg }}>
      {!compact && !collapsed && !keyboardNeedsWidth && navigation}
      <View style={{ flex: 1, minWidth: 0 }}>
        {children(toggle, compact || collapsed || keyboardNeedsWidth)}
      </View>
      <Modal
        visible={compact && drawer}
        animationType="fade"
        transparent
        onRequestClose={() => setDrawer(false)}
      >
        <View
          accessibilityViewIsModal
          style={{
            flex: 1,
            flexDirection: "row",
            backgroundColor: "rgba(0,0,0,0.40)",
          }}
        >
          {navigation}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText("Chiudi menu")}
            style={{ flex: 1 }}
            onPress={() => setDrawer(false)}
          />
        </View>
      </Modal>
    </View>
  );
}
