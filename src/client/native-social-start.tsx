"use client";
import { useUiLanguage } from "./ui-language";

import { useState } from "react";
import { auth } from "./auth-client";
export function NativeSocialStart({
  provider,
  state,
  challenge,
}: {
  provider: "google" | "microsoft";
  state: string;
  challenge: string;
}) {
  const { t: uiText } = useUiLanguage();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    const target =
      "/account/native/return?" +
      new URLSearchParams({ provider, state, challenge });
    try {
      const result = await auth.signIn.social({
        provider,
        callbackURL: target,
        errorCallbackURL: target + "&error=access_failed",
      });
      if (result.error || !result.data?.redirect) throw new Error();
    } catch {
      setError(
        uiText("Accesso non riuscito. Puoi riprovare o tornare all’app."),
      );
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void start()}>
        {busy
          ? uiText("Apertura…")
          : uiText(
              "Continua con {0}",
              String(provider === "google" ? "Google" : "Microsoft"),
            )}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
