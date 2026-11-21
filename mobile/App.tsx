import { useUiLanguage } from "./src/i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { betaRules, currentBetaRule } from "../src/shared/beta-rules";
import type { BetaRulesView } from "../src/contracts/beta-rules";
import { Appearance, useAppearance } from "./src/appearance";
import { NativeLanguageProvider } from "./src/i18n";
import { Account } from "./src/Account";
import { AppHome } from "./src/AppHome";
import {
  ApiError,
  createRequest,
  post,
  problem,
  type NativeRequest,
} from "./src/api";
import {
  clearSession,
  closeSession,
  storedSession,
  type Identity,
  type StoredSession,
} from "./src/session";
import { Action, usePalette } from "./src/ui";

type Login = {
  session: StoredSession;
  user: Identity;
  request: NativeRequest;
  rules: BetaRulesView;
};
const endpoint = "/api/v1/native/session";
const rulesPath = "/api/v1/beta-rules";

function SessionGate() {
  const { t: uiText, locale } = useUiLanguage();
  const [showOriginal, setShowOriginal] = useState(false);
  const c = usePalette();
  const [account, setAccount] = useState<Login | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [consenting, setConsenting] = useState(false);
  const seq = useRef(0);
  const closing = useRef(false);
  const rulesBusy = useRef(false);
  const verifiedToken = useRef<string | null>(null);
  const invalidate = useCallback(() => {
    ++seq.current;
  }, []);
  const translateError = useRef(uiText);
  useEffect(() => {
    translateError.current = uiText;
  }, [uiText]);
  const restore = useCallback(async () => {
    if (closing.current) return;
    const generation = ++seq.current;
    setChecking(true);
    setError("");
    let session: StoredSession | null = null;
    try {
      try {
        session = await storedSession();
      } catch {
        if (generation === seq.current)
          setError(
            translateError.current(
              "L’archivio sicuro del dispositivo non è accessibile. Sblocca il dispositivo e riprova.",
            ),
          );
        return;
      }
      if (generation !== seq.current) return;
      if (session?.closing) {
        await closeSession(session);
        session = null;
      }
      if (!session) {
        if (generation === seq.current) setAccount(null);
        return;
      }
      const current = session;
      const transport = createRequest(current.origin, current.token);
      const user = (await transport<{ user: Identity }>(endpoint)).user;
      const rules = await transport<BetaRulesView>(rulesPath);
      if (rules.actorId !== user.id) throw new Error("Identity mismatch");
      if (generation === seq.current) {
        verifiedToken.current = current.token;
        const guarded = createRequest(current.origin, current.token, () => {
          if (verifiedToken.current !== current.token || closing.current)
            return;
          verifiedToken.current = null;
          // Keep the app covered until the server confirms whether the session is still eligible.
          void restore();
        });
        setAccount((previous) =>
          previous?.session.token === current.token &&
          previous.session.origin === current.origin
            ? { ...previous, user, rules }
            : { session: current, user, rules, request: guarded },
        );
      }
    } catch (cause) {
      if (generation !== seq.current) return;
      if (
        cause instanceof ApiError &&
        (cause.status === 401 || cause.code === "ACCOUNT_INELIGIBLE")
      ) {
        verifiedToken.current = null;
        await clearSession();
        if (generation === seq.current) setAccount(null);
      } else {
        setError(problem(cause, translateError.current));
      }
    } finally {
      if (generation === seq.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    void restore();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void restore();
      else if (state === "background") {
        ++seq.current;
        setChecking(true);
      }
    });
    return () => {
      invalidate();
      verifiedToken.current = null;
      sub.remove();
    };
  }, [restore, invalidate]);
  async function logout() {
    if (closing.current || !account) return;
    closing.current = true;
    verifiedToken.current = null;
    invalidate();
    setChecking(true);
    setError("");
    try {
      await closeSession(account.session);
      setAccount(null);
    } catch (cause) {
      setError(
        uiText(
          "Uscita ancora da confermare. {0}",
          String(problem(cause, uiText)),
        ),
      );
    } finally {
      closing.current = false;
      setChecking(false);
    }
  }
  async function consent() {
    if (!account || rulesBusy.current) return;
    rulesBusy.current = true;
    setConsenting(true);
    try {
      await account.request(
        rulesPath,
        post({
          expectedActorId: account.user.id,
          version: account.rules.version,
          contentDigest: account.rules.contentDigest,
        }),
      );
      await restore();
    } catch (cause) {
      setError(problem(cause, uiText));
    } finally {
      rulesBusy.current = false;
      setConsenting(false);
    }
  }
  const initialOrigin =
    process.env.EXPO_PUBLIC_RIMIAM_URL ??
    (__DEV__
      ? Platform.OS === "android"
        ? "http://10.0.2.2:3000"
        : "http://127.0.0.1:3000"
      : "");
  // Keep the navigation tree mounted when returning from camera, microphone permissions or OAuth.
  // Cover it until the bearer, eligibility and current rules have been revalidated.
  const covered = checking || !!error;
  return (
    <SafeAreaView style={{ backgroundColor: c.bg, flex: 1 }}>
      <StatusBar
        barStyle={useAppearance().dark ? "light-content" : "dark-content"}
      />
      <View
        style={{ flex: 1 }}
        importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={covered}
      >
        {account?.rules.acceptedAt ? (
          <AppHome
            key={account.session.origin + ":" + account.user.id}
            request={account.request}
            origin={account.session.origin}
            user={account.user}
            onLogout={() => void logout()}
          />
        ) : account ? (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            <Text
              accessibilityRole="header"
              style={{ fontSize: 26, color: c.text }}
            >
              {uiText("Regole della beta")}
            </Text>
            <Text
              selectable
              style={{ color: c.text, fontSize: 16, lineHeight: 23 }}
            >
              {currentBetaRule(account.rules)
                ? uiText(betaRules.text)
                : account.rules.text}
            </Text>
            {locale === "en" && currentBetaRule(account.rules) && (
              <>
                <Action
                  variant="quiet"
                  label={
                    showOriginal
                      ? uiText("Chiudi testo originale")
                      : uiText("Testo originale in italiano")
                  }
                  onPress={() => setShowOriginal((v) => !v)}
                />
                {showOriginal && (
                  <Text
                    selectable
                    accessibilityLanguage="it"
                    style={{ color: c.muted }}
                  >
                    {account.rules.text}
                  </Text>
                )}
              </>
            )}
            <Action
              primary
              label={uiText("Accetta e continua")}
              disabled={consenting}
              onPress={() => void consent()}
            />
            <Action label={uiText("Esci")} onPress={() => void logout()} />
          </ScrollView>
        ) : (
          !covered && (
            <Account
              initialOrigin={initialOrigin}
              onSignedIn={() => void restore()}
            />
          )
        )}
      </View>
      {covered && (
        <View
          accessibilityViewIsModal
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: c.bg,
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: 24,
          }}
        >
          {error ? (
            <>
              <Text accessibilityRole="alert" style={{ color: c.text }}>
                {error}
              </Text>
              <Action
                label={uiText("Riprova")}
                onPress={() => void restore()}
              />
            </>
          ) : (
            <ActivityIndicator
              accessibilityLabel={uiText("Verifica accesso")}
              color={c.accent}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Appearance>
        <NativeLanguageProvider>
          <SessionGate />
        </NativeLanguageProvider>
      </Appearance>
    </SafeAreaProvider>
  );
}
