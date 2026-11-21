"use client";
import { useUiLanguage } from "./ui-language";

import { useState } from "react";
import { auth } from "./auth-client";
import { accountErrorMessage } from "../shared/account-navigation";
import { AccountPassword } from "./account-access";

export function LinkAccountLogin({
  returnTo,
  providers,
}: {
  returnTo: string;
  providers: { google: boolean; microsoft: boolean };
}) {
  const { t: uiText } = useUiLanguage();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login(
    method: "google" | "microsoft" | "password",
    data?: FormData,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (method === "password" && data) {
        const r = await auth.signIn.email({
          email: String(data.get("email")).trim(),
          password: String(data.get("password")),
        });
        if (r.error)
          throw new Error(
            uiText(accountErrorMessage(r.error.code, r.error.status)),
          );
        window.location.replace(returnTo);
        return;
      }
      if (method !== "password") {
        const r = await auth.signIn.social({
          provider: method,
          callbackURL: returnTo,
          errorCallbackURL: returnTo,
        });
        if (r.error)
          throw new Error(
            uiText(accountErrorMessage(r.error.code, r.error.status)),
          );
        if (r.data?.redirect) return;
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : uiText("Connessione non riuscita."),
      );
    }
    setBusy(false);
  }
  return (
    <>
      <p>
        {uiText(
          "Per collegare un nuovo metodo, accedi nel browser con il tuo account RIMIAM già verificato.",
        )}
      </p>
      {(["google", "microsoft"] as const)
        .filter((p) => providers[p])
        .map((p) => (
          <button
            key={p}
            disabled={busy}
            type="button"
            onClick={() => void login(p)}
          >
            {uiText("Accedi con ")}
            {p === "google" ? uiText("Google") : uiText("Microsoft")}
          </button>
        ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void login("password", new FormData(e.currentTarget));
        }}
      >
        <label>
          {uiText("Email")}{" "}
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            disabled={busy}
          />
        </label>
        <AccountPassword signup={false} disabled={busy} />
        <button disabled={busy}>{uiText("Accedi con password")}</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function SwitchLinkAccount({ returnTo }: { returnTo: string }) {
  const { t: uiText } = useUiLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change() {
    setBusy(true);
    setError("");
    try {
      const result = await auth.signOut();
      if (result.error)
        throw new Error(
          uiText(accountErrorMessage(result.error.code, result.error.status)),
        );
      window.location.replace(returnTo);
    } catch {
      setError(uiText("Non è stato possibile uscire dal browser. Riprova."));
      setBusy(false);
    }
  }
  return (
    <>
      <button disabled={busy} type="button" onClick={() => void change()}>
        {uiText("Esci da RIMIAM nel browser e cambia account")}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
