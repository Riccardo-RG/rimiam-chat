import { useUiLanguage } from "./i18n";
import React, { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeControl } from "./AppShell";
import { Action, usePalette } from "./ui";
import { post, problem, type NativeRequest } from "./api";
import { useResource } from "./useResource";

type Invitation = {
  id: string;
  workspaceName: string;
  inviterName: string;
  expiresAt: string;
};
export function IncomingInvitations({
  request,
  onAccepted,
  refreshSpaces,
}: {
  request: NativeRequest;
  refreshSpaces: () => void;
  onAccepted: (id: string, name: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const inbox = useResource<{ invitations: Invitation[] }>(
    request,
    "/api/v1/invitations",
    30000,
  );
  const c = usePalette(),
    safe = useSafeAreaInsets();
  const [visible, show] = useState(false),
    [selected, select] = useState<Invitation | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [acknowledged, acknowledge] = useState(false);
  const lock = useRef(false);
  const items = inbox.value?.invitations ?? [];
  const close = () => {
    if (lock.current) return;
    show(false);
    select(null);
    setError("");
  };
  const open = (item: Invitation | null) => {
    select(item);
    acknowledge(false);
    setError("");
    show(true);
  };
  async function accept(inv: Invitation) {
    if (lock.current || !acknowledged) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ workspaceId: string }>(
        "/api/v1/invitations/" + inv.id + "/accept",
        post({ fullHistoryAccepted: true }),
      );
      show(false);
      select(null);
      inbox.refresh();
      onAccepted(result.workspaceId, inv.workspaceName);
    } catch (e) {
      setError(problem(e));
      inbox.refresh();
      refreshSpaces();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!items.length && !inbox.error && !visible) return null;
  return (
    <View
      style={{
        marginVertical: 5,
        borderColor: c.line,
        borderWidth: StyleSheet.hairlineWidth,
        borderLeftWidth: 2,
        borderLeftColor: c.heading,
        borderRadius: 8,
        backgroundColor: c.surface,
        paddingHorizontal: 10,
      }}
    >
      {!!items.length && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            items.length === 1
              ? uiText(
                  "{0} ti invita in {1} · Vedi invito",
                  String(items[0].inviterName),
                  String(items[0].workspaceName),
                )
              : uiText("Mostra {0} inviti", String(items.length))
          }
          onPress={() => open(items.length === 1 ? items[0] : null)}
          style={({ pressed }) => ({
            minHeight: 46,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 6,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, color: c.text, fontWeight: "700" }}>
              {items.length === 1
                ? items[0].workspaceName
                : uiText("Inviti ricevuti")}
            </Text>
            {items.length === 1 && (
              <Text style={{ color: c.muted, fontSize: 13 }}>
                {uiText("Ti invita ")}
                {items[0].inviterName}
              </Text>
            )}
          </View>
          <Text style={{ fontSize: 14, color: c.heading, fontWeight: "600" }}>
            {items.length === 1
              ? uiText("Vedi invito")
              : uiText("Mostra {0} inviti", String(items.length))}
          </Text>
        </Pressable>
      )}
      {inbox.error && (
        <>
          <Text accessibilityRole="alert" style={{ color: c.text }}>
            {uiText("Non riesco a caricare gli inviti. ")}
            {inbox.error}
          </Text>
          <HomeControl
            label={uiText("Ricarica inviti")}
            onPress={inbox.refresh}
          />
        </>
      )}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <View
          accessibilityViewIsModal
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,.42)",
            paddingHorizontal: 14,
            paddingTop: Math.max(safe.top, 10),
            paddingBottom: Math.max(safe.bottom, 10),
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText("Chiudi inviti")}
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={{
              maxHeight: "96%",
              width: "100%",
              maxWidth: 470,
              padding: 14,
              backgroundColor: c.surface,
              borderRadius: 14,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderColor: c.line,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{
                  flex: 1,
                  fontSize: 20,
                  color: c.heading,
                  fontWeight: "700",
                }}
              >
                {selected
                  ? uiText("Invito allo spazio")
                  : uiText("Inviti ricevuti")}
              </Text>
              <HomeControl
                icon="close"
                label={uiText("Chiudi")}
                disabled={busy}
                onPress={close}
              />
            </View>
            <ScrollView contentContainerStyle={{ paddingVertical: 8, gap: 8 }}>
              {selected ? (
                <>
                  <Text
                    style={{ fontSize: 18, color: c.text, fontWeight: "700" }}
                  >
                    {selected.workspaceName}
                  </Text>
                  <Text style={{ fontSize: 15, color: c.muted }}>
                    {uiText("Ti invita ")}
                    {selected.inviterName}
                  </Text>
                  <Text style={{ fontSize: 16, color: c.text }}>
                    {uiText(
                      "Entrando potrai scrivere e leggere tutta la storia condivisa, anche messaggi, fonti e documenti precedenti al tuo ingresso. Anche i futuri membri avranno questa visibilità.",
                    )}
                  </Text>
                  <Text style={{ fontSize: 14, color: c.muted }}>
                    {uiText(
                      "L’ingresso non assegna permessi di invito o amministrazione. Se esci, i contenuti già condivisi rimangono nello spazio.",
                    )}
                  </Text>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityLabel={uiText(
                      "Accetto la visibilità della storia",
                    )}
                    accessibilityState={{
                      checked: acknowledged,
                      disabled: busy,
                    }}
                    disabled={busy}
                    onPress={() => acknowledge((current) => !current)}
                    style={{
                      minHeight: 48,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <View
                      pointerEvents="none"
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <Switch value={acknowledged} />
                    </View>
                    <Text style={{ flex: 1, fontSize: 15, color: c.text }}>
                      {uiText(
                        "Accetto di entrare con questa visibilità della storia.",
                      )}
                    </Text>
                  </Pressable>
                  <Action
                    label={uiText("Accetta ed entra")}
                    primary
                    disabled={busy || !acknowledged}
                    onPress={() => void accept(selected)}
                  />
                  {items.length > 1 && (
                    <HomeControl
                      label={uiText("Tutti gli inviti")}
                      disabled={busy}
                      onPress={() => select(null)}
                    />
                  )}
                </>
              ) : (
                items.map((item) => (
                  <View
                    key={item.id}
                    style={{
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderColor: c.line,
                    }}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={uiText(
                        "{0} · Ti invita {1} · Vedi invito",
                        String(item.workspaceName),
                        String(item.inviterName),
                      )}
                      style={{ paddingVertical: 8, minHeight: 48, gap: 2 }}
                      onPress={() => open(item)}
                    >
                      <Text
                        style={{
                          fontSize: 17,
                          fontWeight: "700",
                          color: c.text,
                        }}
                      >
                        {item.workspaceName}
                      </Text>
                      <Text style={{ fontSize: 14, color: c.muted }}>
                        {uiText("Ti invita ")}
                        {item.inviterName}
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
              {!!error && (
                <Text accessibilityRole="alert" style={{ color: c.text }}>
                  {error}
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
