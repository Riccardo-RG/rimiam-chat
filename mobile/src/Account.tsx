import { useUiLanguage } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  ImageBackground,
  Pressable,
  useWindowDimensions,
  StyleSheet,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Action, Field, usePalette } from "./ui";
import { useAppearance } from "./appearance";
import { LanguageChoice } from "./LanguageChoice";
import brand from "../assets/brand-mark.png";
import costa from "../assets/costa.jpg";
import porto from "../assets/porto.jpg";
import { createRequest, post, problem } from "./api";
import { apiOrigin } from "./origin";
import { saveSession, type StoredSession, type Identity } from "./session";
import {
  beginSocial,
  completeSocial,
  SocialSignInError,
} from "./account/social";
import { nativeSocialCallback } from "./account/social-callback";

export function Account({
  onSignedIn,
  initialOrigin,
}: {
  onSignedIn: (session: StoredSession, user: Identity) => void;
  initialOrigin: string;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const appearance = useAppearance();
  const { width, height, fontScale } = useWindowDimensions();
  const wide = width > 780 && width / fontScale > 700;
  const compact = height < 520;
  const [passwordVisible, showPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "register" | "recovery">("login");
  const [origin, setOrigin] = useState(initialOrigin),
    [editingServer, setEditingServer] = useState(!initialOrigin);
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState("");
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;
  const [providers, setProviders] = useState<{
    host: string;
    google: boolean;
    microsoft: boolean;
  } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [check, setCheck] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setProviders(null);
    setUnavailable(false);
    if (editingServer) return;
    let host: string;
    try {
      host = apiOrigin(origin, __DEV__);
    } catch {
      return;
    }
    void createRequest(host)<{ google: boolean; microsoft: boolean }>(
      "/api/v1/native/social/providers",
      { signal: abort.signal },
    )
      .then((v) => {
        if (!abort.signal.aborted)
          setProviders({
            host,
            google: v.google === true,
            microsoft: v.microsoft === true,
          });
      })
      .catch(() => {
        if (!abort.signal.aborted) setUnavailable(true);
      });
    return () => abort.abort();
  }, [editingServer, origin, check]);
  const translateError = useRef(uiText);
  useEffect(() => {
    translateError.current = uiText;
  }, [uiText]);
  useEffect(() => {
    let mounted = true;
    function resume(url: string | null) {
      if (
        !url?.startsWith(nativeSocialCallback + "?") ||
        gate.current ||
        !mounted
      )
        return;
      gate.current = true;
      setBusy(true);
      void completeSocial(url)
        .then((v) => {
          if (mounted) signedIn.current(v.session, v.user);
        })
        .catch((e) => {
          if (mounted)
            setStatus(
              e instanceof SocialSignInError
                ? translateError.current(e.message)
                : problem(e, translateError.current),
            );
        })
        .finally(() => {
          gate.current = false;
          if (mounted) setBusy(false);
        });
    }
    const sub = Linking.addEventListener("url", (e) => resume(e.url));
    void Linking.getInitialURL()
      .then(resume)
      .catch(() => {});
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  async function social(provider: "google" | "microsoft") {
    if (gate.current || !providers?.[provider] || editingServer) return;
    gate.current = true;
    setBusy(true);
    setStatus("");
    try {
      const v = await beginSocial(providers.host, provider);
      if (v) {
        setPassword("");
        onSignedIn(v.session, v.user);
      }
    } catch (e) {
      setStatus(
        e instanceof SocialSignInError ? uiText(e.message) : problem(e, uiText),
      );
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  function switchMode(next: typeof mode) {
    setMode(next);
    showPassword(false);
    setPassword("");
    setStatus("");
  }
  async function submit(action: typeof mode | "resend") {
    if (gate.current) return;
    let host: string;
    try {
      host = apiOrigin(origin, __DEV__);
    } catch {
      setStatus(uiText("Controlla l’indirizzo HTTPS del tuo server."));
      setEditingServer(true);
      return;
    }
    if (
      !email.trim() ||
      (action === "login" && !password) ||
      (action === "register" && (!name.trim() || password.length < 12))
    ) {
      setStatus(
        action === "register"
          ? uiText(
              "Inserisci nome, email e una password di almeno 12 caratteri.",
            )
          : uiText("Completa i campi richiesti."),
      );
      return;
    }
    gate.current = true;
    setBusy(true);
    setStatus("");
    const request = createRequest(host);
    try {
      if (action === "login") {
        const result = await request<{ token: string; user: Identity }>(
          "/api/v1/native/session",
          post({ email: email.trim(), password }),
        );
        const session = { origin: host, token: result.token, closing: false };
        try {
          await saveSession(session);
        } catch {
          await createRequest(host, result.token)("/api/v1/native/session", {
            method: "DELETE",
          }).catch(() => undefined);
          setStatus(
            uiText(
              "Non riesco a salvare l’accesso in modo sicuro sul dispositivo. Riprova.",
            ),
          );
          return;
        }
        setPassword("");
        onSignedIn(session, result.user);
      } else {
        const payload =
          action === "register"
            ? {
                action: "register",
                email: email.trim(),
                name: name.trim(),
                password,
              }
            : {
                action:
                  action === "recovery"
                    ? "request-password-reset"
                    : "send-verification",
                email: email.trim(),
              };
        await request("/api/v1/native/account", post(payload));
        switchMode("login");
        setStatus(
          uiText(
            "Se la richiesta è applicabile, riceverai un’email con il prossimo passo.",
          ),
        );
      }
    } catch (e) {
      setStatus(problem(e, uiText));
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          flexDirection: wide ? "row" : "column",
          backgroundColor: c.bg,
        }}
      >
        <ImageBackground
          source={appearance.dark ? porto : costa}
          resizeMode="cover"
          style={{
            width: wide ? "48%" : "100%",
            paddingHorizontal: wide ? 38 : 22,
            paddingVertical: compact ? 10 : 20,
            minHeight: wide ? height : undefined,
            justifyContent: "space-between",
            gap: compact ? 4 : 12,
            backgroundColor: "#302735",
          }}
        >
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "rgba(29,29,37,.62)" },
            ]}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Image source={brand} style={{ width: 37, height: 37 }} />
            <Text
              style={{
                fontSize: 34,
                fontWeight: "700",
                color: "#fffaf3",
                letterSpacing: -2,
              }}
            >
              {uiText("rimiam")}
            </Text>
          </View>
          <View style={{ gap: 6 }}>
            <Text
              accessibilityRole="header"
              style={{
                color: "#fffaf3",
                fontWeight: "700",
                fontSize: wide ? 58 : compact ? 30 : 38,
                letterSpacing: -1.8,
              }}
            >
              {uiText("La chat di progetto.")}
            </Text>
            <Text
              style={{
                color: "#f4eeef",
                fontSize: 15,
                lineHeight: 22,
                maxWidth: 540,
              }}
            >
              {uiText(
                "Parla con il tuo gruppo. Con Emme puoi ritrovare una decisione, confrontare le fonti e riprendere il lavoro da dove l’avete lasciato.",
              )}
            </Text>
          </View>
        </ImageBackground>
        <View
          style={{
            flexGrow: 1,
            flexBasis: wide ? 0 : "auto",
            minWidth: 0,
            justifyContent: "center",
            paddingHorizontal: wide ? 32 : 22,
            paddingVertical: compact ? 12 : 23,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 485,
              alignSelf: "center",
              gap: 12,
            }}
          >
            <LanguageChoice />
            {mode !== "recovery" && (
              <View
                style={{
                  flexDirection: "row",
                  gap: 22,
                  borderBottomWidth: 1,
                  borderColor: c.line,
                }}
              >
                {(["login", "register"] as const).map((key) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={
                      key === "login"
                        ? uiText("Accedi con un account esistente")
                        : uiText("Crea un account")
                    }
                    accessibilityState={{
                      selected: mode === key,
                      disabled: busy,
                    }}
                    disabled={busy}
                    onPress={() => switchMode(key)}
                    style={{
                      minHeight: 48,
                      justifyContent: "center",
                      borderBottomWidth: 2,
                      borderColor: mode === key ? c.accent : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: "600",
                        color: mode === key ? c.accent : c.muted,
                      }}
                    >
                      {key === "login"
                        ? uiText("Accedi")
                        : uiText("Crea un account")}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text
              accessibilityRole="header"
              style={{
                fontSize: wide ? 43 : 35,
                fontWeight: "500",
                letterSpacing: -1.6,
                color: c.text,
              }}
            >
              {mode === "login"
                ? uiText("Entra in RIMIAM")
                : mode === "register"
                  ? uiText("Crea il tuo account")
                  : uiText("Recupera la password")}
            </Text>
            {mode === "register" && (
              <Text style={{ color: c.muted, fontSize: 15 }}>
                {uiText("Se scegli l’email, riceverai un link di verifica.")}
              </Text>
            )}
            {mode !== "recovery" && !editingServer && (
              <>
                {providers?.google && (
                  <Action
                    variant="outline"
                    label={uiText("Continua con Google")}
                    disabled={busy}
                    onPress={() => void social("google")}
                  />
                )}
                {providers?.microsoft && (
                  <Action
                    variant="outline"
                    label={uiText("Continua con Microsoft")}
                    disabled={busy}
                    onPress={() => void social("microsoft")}
                  />
                )}
                {providers && (!providers.google || !providers.microsoft) && (
                  <Text
                    style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}
                  >
                    {!providers.google && !providers.microsoft
                      ? uiText(
                          "L’accesso con Google e Microsoft non è ancora attivo. Puoi usare email e password.",
                        )
                      : uiText(
                          "L’accesso con {0} non è ancora attivo.",
                          String(providers.google ? "Microsoft" : "Google"),
                        )}
                  </Text>
                )}
                {(providers?.google || providers?.microsoft) && (
                  <Text style={{ textAlign: "center", color: c.muted }}>
                    {uiText("oppure con email")}
                  </Text>
                )}
                {!providers && !unavailable && (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{ color: c.muted }}
                  >
                    {uiText("Verifica dei metodi di accesso…")}
                  </Text>
                )}
                {unavailable && (
                  <Action
                    label={uiText("Ricontrolla metodi di accesso")}
                    disabled={busy}
                    onPress={() => setCheck((n) => n + 1)}
                  />
                )}
              </>
            )}
            {mode === "register" && (
              <Field
                label={uiText("Nome")}
                value={name}
                onChangeText={setName}
                editable={!busy}
                autoComplete="name"
              />
            )}
            <Field
              label={uiText("Email")}
              value={email}
              onChangeText={setEmail}
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
            />
            {mode !== "recovery" && (
              <Field
                label={uiText("Password")}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!passwordVisible}
                editable={!busy}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                onSubmitEditing={() => void submit(mode)}
                returnKeyType="go"
              />
            )}
            {mode !== "recovery" && (
              <Pressable
                accessibilityRole="button"
                onPress={() => showPassword(!passwordVisible)}
                style={{
                  alignSelf: "flex-end",
                  minHeight: 44,
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: c.muted, fontWeight: "600" }}>
                  {passwordVisible
                    ? uiText("Nascondi password")
                    : uiText("Mostra password")}
                </Text>
              </Pressable>
            )}
            {!!status && (
              <Text accessibilityRole="alert" style={{ color: c.text }}>
                {status}
              </Text>
            )}
            <Action
              label={
                busy
                  ? uiText("Attendi…")
                  : mode === "login"
                    ? uiText("Accedi")
                    : mode === "register"
                      ? uiText("Registrati")
                      : uiText("Invia il link")
              }
              primary
              disabled={busy}
              onPress={() => void submit(mode)}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              {mode === "login" && (
                <Action
                  variant="quiet"
                  label={uiText("Password dimenticata?")}
                  disabled={busy}
                  onPress={() => switchMode("recovery")}
                />
              )}
              {mode !== "recovery" && (
                <Action
                  variant="quiet"
                  label={uiText("Reinvia verifica email")}
                  disabled={busy}
                  onPress={() => void submit("resend")}
                />
              )}
              {mode === "recovery" && (
                <Action
                  variant="quiet"
                  label={uiText("Torna all’accesso")}
                  onPress={() => switchMode("login")}
                  disabled={busy}
                />
              )}
            </View>
            {!editingServer && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                {(
                  [
                    ["Regole della beta ↗", "/beta"],
                    ["Account, calendari e dati ↗", "/connessioni-e-dati"],
                  ] as const
                ).map(([label, path]) => (
                  <Action
                    key={path}
                    variant="quiet"
                    label={uiText(label)}
                    onPress={() => {
                      void Linking.openURL(
                        apiOrigin(origin, __DEV__) + path,
                      ).catch(() =>
                        setStatus(uiText("Impossibile aprire la pagina.")),
                      );
                    }}
                  />
                ))}
              </View>
            )}
            {editingServer ? (
              <Field
                label={uiText("Indirizzo del server")}
                value={origin}
                editable={!busy}
                onChangeText={setOrigin}
                placeholder="https://chat.example.org"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            ) : (
              <Action
                label={uiText("Server · {0}", String(origin))}
                variant="quiet"
                onPress={() => setEditingServer(true)}
                disabled={busy}
              />
            )}
            {editingServer && (
              <Action
                label={uiText("Usa questo server")}
                disabled={busy}
                onPress={() => {
                  try {
                    setOrigin(apiOrigin(origin, __DEV__));
                    setEditingServer(false);
                    setStatus("");
                  } catch {
                    setStatus(
                      uiText("Controlla l’indirizzo HTTPS del tuo server."),
                    );
                  }
                }}
              />
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
              {(["system", "light", "dark"] as const).map((m, i) => (
                <Action
                  key={m}
                  variant={
                    appearance.settings.mode === m ? "selected" : "quiet"
                  }
                  label={uiText(["Sistema", "Chiaro", "Scuro"][i])}
                  onPress={() =>
                    appearance.save({ ...appearance.settings, mode: m })
                  }
                />
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
