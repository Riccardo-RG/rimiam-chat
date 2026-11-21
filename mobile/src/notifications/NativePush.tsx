import { useUiLanguage } from "../i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import * as Crypto from "expo-crypto";
import * as Store from "expo-secure-store";
import Constants from "expo-constants";
import { Action, usePalette } from "../ui";
import { ApiError, post, problem, type NativeRequest } from "../api";
import { notificationAddress } from "./address";
import {
  inspectPushPreference,
  type DevicePreference,
  type PushPreference,
} from "./device-preference";

const channel = "rimiam-updates",
  storage = { keychainAccessible: Store.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const provider = Platform.OS === "ios" ? "apns" : "fcm";
type Bound = { device: string; tokenHash: string };
const hash = (s: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);
const key = async (origin: string) => "rimiam.push." + (await hash(origin));
async function bound(origin: string): Promise<Bound | null> {
  const value = await Store.getItemAsync(
    (await key(origin)) + ".device",
    storage,
  );
  if (!value) return null;
  const info = JSON.parse(value);
  return typeof info?.device === "string" && typeof info?.tokenHash === "string"
    ? info
    : null;
}
async function installation(origin: string) {
  const name = (await key(origin)) + ".installation";
  const previous = await Store.getItemAsync(name, storage);
  if (previous) return previous;
  const id = Crypto.randomUUID();
  await Store.setItemAsync(name, id, storage);
  return id;
}
const path = "/api/v1/native/push";
function noticeAddress({ request }: Notifications.Notification) {
  const trigger = request.trigger;
  return notificationAddress(
    request.content.data,
    trigger && "type" in trigger && trigger.type === "push"
      ? trigger.payload
      : undefined,
  );
}
const permissionAllowed = (
  status: Notifications.NotificationPermissionsStatus,
) =>
  status.granted ||
  status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
async function permissions() {
  const os = await Notifications.getPermissionsAsync();
  const androidChannel =
    Platform.OS === "android"
      ? await Notifications.getNotificationChannelAsync(channel)
      : null;
  return {
    allowed:
      permissionAllowed(os) &&
      androidChannel?.importance !== Notifications.AndroidImportance.NONE,
    canAsk:
      os.canAskAgain &&
      androidChannel?.importance !== Notifications.AndroidImportance.NONE,
  };
}

async function openNotificationSettings() {
  const androidPackage = Constants.expoConfig?.android?.package;
  if (Platform.OS === "android" && Platform.Version >= 26 && androidPackage) {
    try {
      await Linking.sendIntent("android.settings.APP_NOTIFICATION_SETTINGS", [
        { key: "android.provider.extra.APP_PACKAGE", value: androidPackage },
      ]);
      return;
    } catch {
      // A device manufacturer can omit the notification-specific activity.
    }
  }
  await Linking.openSettings();
}

export function NativePushSettings(props: {
  request: NativeRequest;
  origin: string;
  workspaceId: string;
}) {
  return (
    <PushSettings key={props.origin + ":" + props.workspaceId} {...props} />
  );
}
function PushSettings({
  request,
  origin,
  workspaceId,
}: {
  request: NativeRequest;
  origin: string;
  workspaceId: string;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const [pref, setPref] = useState<DevicePreference | null>(null),
    [permission, setPermission] = useState({ allowed: false, canAsk: true });
  const [issue, setIssue] = useState(""),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    mutation = useRef(false);
  const nextEpoch = useCallback(() => ++epoch.current, []);
  const refresh = useCallback(
    async (rotatedToken?: Notifications.DevicePushToken) => {
      const turn = nextEpoch();
      try {
        const [binding, os] = await Promise.all([bound(origin), permissions()]);
        const p = await request<PushPreference>(
          path +
            "?workspace=" +
            workspaceId +
            "&provider=" +
            provider +
            (binding ? "&device=" + encodeURIComponent(binding.device) : ""),
        );
        if (turn !== epoch.current) return;
        setPermission(os);
        setIssue("");
        await inspectPushPreference(
          p,
          binding && os.allowed
            ? async () => {
                const current =
                  rotatedToken ??
                  (await Notifications.getDevicePushTokenAsync());
                return (
                  current.type === Platform.OS &&
                  typeof current.data === "string" &&
                  (await hash(current.data)) === binding.tokenHash
                );
              }
            : undefined,
          (value) => {
            if (turn === epoch.current) setPref(value);
          },
        );
      } catch (e) {
        if (turn === epoch.current) setIssue(problem(e));
      }
    },
    [nextEpoch, request, origin, workspaceId],
  );
  useEffect(() => {
    void refresh();
    const onReturn = AppState.addEventListener("change", (s) => {
      if (s === "active" && !mutation.current) void refresh();
    });
    const changed = Notifications.addPushTokenListener((token) => {
      if (!mutation.current) void refresh(token);
    });
    return () => {
      nextEpoch();
      onReturn.remove();
      changed.remove();
    };
  }, [nextEpoch, refresh]);
  async function change(enable: boolean) {
    if (!pref || mutation.current) return;
    const turn = nextEpoch();
    mutation.current = true;
    setBusy(true);
    setIssue("");
    try {
      if (enable) {
        if (Platform.OS === "android")
          await Notifications.setNotificationChannelAsync(channel, {
            name: uiText("Aggiornamenti degli spazi"),
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        let os = await permissions();
        if (!os.allowed && os.canAsk) {
          await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: false, allowSound: true },
          });
          os = await permissions();
        }
        if (turn !== epoch.current) return;
        setPermission(os);
        if (!os.allowed) {
          setIssue(uiText("Il dispositivo non ha consentito gli avvisi."));
          return;
        }
        const [credential, inst] = await Promise.all([
          Notifications.getDevicePushTokenAsync(),
          installation(origin),
        ]);
        if (
          typeof credential.data !== "string" ||
          credential.type !== Platform.OS
        )
          throw Error("DEVICE_TOKEN_UNAVAILABLE");
        if (turn !== epoch.current) return;
        const result = await request<{ deviceId: string }>(
          path,
          post({
            operation: "enable",
            workspaceId,
            consent: true,
            installation: inst,
            localizedAlerts: true,
            subscription: { provider, token: credential.data },
          }),
        );
        await Store.setItemAsync(
          (await key(origin)) + ".device",
          JSON.stringify({
            device: result.deviceId,
            tokenHash: await hash(credential.data),
          }),
          storage,
        );
      } else if (pref.deviceId)
        await request(
          path,
          post({
            operation: "disable",
            provider,
            deviceId: pref.deviceId,
            workspaceId,
          }),
        );
      if (turn === epoch.current) await refresh();
    } catch (e) {
      if (turn === epoch.current)
        setIssue(
          e instanceof ApiError
            ? problem(e)
            : uiText(
                "Il telefono non ha completato la registrazione. Controlla la connessione e la configurazione delle notifiche dell’app.",
              ),
        );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: 19, fontWeight: "600", color: c.text }}
      >
        {uiText("Notifiche su questo telefono")}
      </Text>
      <Text style={{ color: c.muted }}>
        {!pref
          ? uiText("Verifica delle notifiche…")
          : !pref.configured
            ? uiText(
                "Il gestore di questa installazione deve configurare gli avvisi per questo sistema.",
              )
            : pref.tokenCheck === "checking"
              ? uiText("Verifica della registrazione di questo telefono…")
              : pref.tokenCheck === "unavailable"
                ? uiText(
                    "La preferenza è salvata. In questo momento il telefono non riesce a verificare gli avvisi.",
                  )
                : pref.enabled && permission.allowed
                  ? uiText("Avvisi attivi per questo spazio.")
                  : pref.optedIn
                    ? uiText(
                        "Controlla i permessi e riattiva questo dispositivo.",
                      )
                    : uiText(
                        "Puoi ricevere un avviso generico quando ci sono novità nello spazio.",
                      )}
      </Text>
      {pref?.configured &&
        pref.tokenCheck === "idle" &&
        (!pref.enabled || !permission.allowed) &&
        (permission.canAsk || permission.allowed) && (
          <Action
            label={uiText("Attiva per questo spazio")}
            disabled={busy}
            onPress={() => void change(true)}
          />
        )}
      {pref?.optedIn && (
        <Action
          label={uiText("Disattiva per questo spazio")}
          disabled={busy}
          onPress={() => void change(false)}
        />
      )}
      <Action
        label={uiText("Apri impostazioni del dispositivo")}
        onPress={() =>
          void openNotificationSettings().catch(() =>
            setIssue(
              uiText(
                "Apri le impostazioni di RIMIAM sul telefono e scegli Notifiche.",
              ),
            ),
          )
        }
      />
      {(!!issue || pref?.tokenCheck === "unavailable") && (
        <>
          {!!issue && (
            <Text accessibilityRole="alert" style={{ color: c.text }}>
              {issue}
            </Text>
          )}
          <Action
            label={uiText("Riprova verifica")}
            disabled={busy}
            onPress={() => void refresh()}
          />
        </>
      )}
    </View>
  );
}

// Foreground users are already in RIMIAM. Only a deliberate tap navigates.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function usePushNavigation(
  request: NativeRequest | null,
  origin: string,
  onOpenWorkspace: (workspaceId: string) => void,
) {
  const navigate = useRef(onOpenWorkspace);
  navigate.current = onOpenWorkspace;
  useEffect(() => {
    if (!request || !origin) return;
    let current = true,
      examining: string | undefined;
    const handled = new Set<string>();
    async function open(response: Notifications.NotificationResponse | null) {
      if (
        !response ||
        response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
      )
        return;
      const address = noticeAddress(response.notification);
      if (!address || handled.has(address.id) || examining === address.id)
        return;
      examining = address.id;
      try {
        const binding = await bound(origin);
        if (!current || binding?.device !== address.deviceId) return;
        const target = await request!<{ workspaceId: string }>(
          path + "/target?id=" + address.id + "&device=" + address.deviceId,
        );
        if (!current || examining !== address.id) return;
        handled.add(address.id);
        navigate.current(target.workspaceId);
        const last = await Notifications.getLastNotificationResponseAsync();
        if (
          current &&
          last &&
          noticeAddress(last.notification)?.id === address.id
        )
          await Notifications.clearLastNotificationResponseAsync();
      } catch {
        /* An offline, expired or foreign notice never opens a Workspace. */
      } finally {
        if (examining === address.id) examining = undefined;
      }
    }
    const listener = Notifications.addNotificationResponseReceivedListener(
      (r) => void open(r),
    );
    const pending = () =>
      void Notifications.getLastNotificationResponseAsync()
        .then(open)
        .catch(() => {});
    pending();
    const active = AppState.addEventListener("change", (state) => {
      if (state === "active") pending();
    });
    return () => {
      current = false;
      listener.remove();
      active.remove();
    };
  }, [request, origin]);
}
