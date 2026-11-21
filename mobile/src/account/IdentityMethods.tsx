import { useUiLanguage } from "../i18n";
import { useRef, useState } from "react";
import { View } from "react-native";
import * as Browser from "expo-web-browser";
import type { NativeLinkedMethods } from "../../../src/contracts/native-social";
import { type NativeRequest, problem } from "../api";
import { useResource } from "../useResource";
import { Action } from "../ui";
import { Label, Section } from "../integrations/parts";

export function IdentityMethods({
  request,
  origin,
  user,
}: {
  request: NativeRequest;
  origin: string;
  user: { id: string; email: string };
}) {
  const { t: uiText } = useUiLanguage();
  const methods = useResource<NativeLinkedMethods>(
    request,
    "/api/v1/native/social/accounts",
  );
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function start(provider: "google" | "microsoft") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await Browser.openAuthSessionAsync(
        origin +
          "/account/native/link?" +
          new URLSearchParams({ actor: user.id, provider }),
        "com.rimiam.chat:/oauth/linked",
        { preferEphemeralSession: true },
      );
    } catch (e) {
      setError(problem(e));
    } finally {
      lock.current = false;
      setBusy(false);
      methods.refresh();
    }
  }
  return (
    <Section title={uiText("Metodi di accesso")}>
      <Label>{user.email}</Label>
      {methods.value ? (
        (["google", "microsoft"] as const).map((provider) => {
          const m = methods.value![provider],
            name = provider === "google" ? "Google" : "Microsoft";
          return (
            <View key={provider}>
              {m.linked ? (
                <Label>
                  {name}
                  {uiText(" · Collegato")}
                  {m.available ? "" : uiText(" · Disattivato sul server")}
                </Label>
              ) : m.available ? (
                <Action
                  label={uiText("Collega {0}", String(name))}
                  disabled={busy}
                  onPress={() => void start(provider)}
                />
              ) : (
                <Label>
                  {name}
                  {uiText(" · Disattivato sul server")}
                </Label>
              )}
            </View>
          );
        })
      ) : (
        <Label>
          {methods.error || uiText("Verifica dei metodi di accesso…")}
        </Label>
      )}
      {methods.error && (
        <Action label={uiText("Riprova")} onPress={methods.refresh} />
      )}
      {!!error && <Label>{error}</Label>}
    </Section>
  );
}
