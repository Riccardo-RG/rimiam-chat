"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import { auth } from "./auth-client";
import { accountErrorMessage } from "../shared/account-navigation";

export function ConnectSignIn({
  provider,
  returnTo,
  nativeActor,
}: {
  provider: "google" | "microsoft";
  returnTo: string;
  nativeActor?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const label = provider === "google" ? "Google" : "Microsoft";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (event.persisted) {
        active.current = false;
        setBusy(false);
      }
    }
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  async function connect() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    const target = nativeActor
      ? "/account/native/link?" +
        new URLSearchParams({ actor: nativeActor, provider })
      : `/account/access?${new URLSearchParams({ returnTo, provider })}`;
    try {
      const result = await auth.linkSocial(
        {
          provider,
          callbackURL: target,
          errorCallbackURL: target,
        },
        nativeActor
          ? { headers: { "x-rimiam-link-account": nativeActor } }
          : undefined,
      );
      if (!result.error && result.data?.redirect && result.data.url) return;
      setError(
        uiText(accountErrorMessage(result.error?.code, result.error?.status)),
      );
    } catch {
      setError(uiText("Connessione non disponibile. Riprova."));
    }
    active.current = false;
    setBusy(false);
  }
  return (
    <>
      <button
        type="button"
        aria-label={uiText("Collega {0}", String(label))}
        disabled={busy}
        onClick={() => void connect()}
      >
        {busy ? uiText("Apertura…") : uiText("Collega")}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
