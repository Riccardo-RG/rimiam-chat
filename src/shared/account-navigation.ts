// Only known application destinations survive an account flow; never redirect to an arbitrary caller URL.
export function safeAccountReturn(raw: string | null | undefined): string {
  if (!raw || !(raw === "/" || raw.startsWith("/?"))) return "/";
  const url = new URL(raw, "https://miriam.invalid");
  if (url.origin !== "https://miriam.invalid" || url.pathname !== "/")
    return "/";
  const invite = url.searchParams.get("invite");
  if (invite && isInvitationToken(invite))
    return `/?invite=${encodeURIComponent(invite)}`;
  const workspace = url.searchParams.get("workspace");
  if (
    workspace &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      workspace,
    )
  )
    return `/?workspace=${workspace}`;
  return "/";
}

function isInvitationToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
export function accountReturnFromSearch(search: string) {
  const params = new URLSearchParams(search);
  return safeAccountReturn(params.get("returnTo") ?? `/${search}`);
}

export function workspaceEntryFromSearch(search: string) {
  const params = new URLSearchParams(search);
  // An already signed-in browser can land on the same local callback URL as the
  // login form. Resolve its allowlisted destination before showing the directory.
  const target =
    params.has("returnTo") && !params.has("invite")
      ? new URL(accountReturnFromSearch(search), "https://miriam.invalid")
          .searchParams
      : params;
  const token = target.get("invite");
  return {
    invitation: token && isInvitationToken(token) ? token : "",
    invalidInvitation: token !== null && !isInvitationToken(token),
    workspace: token !== null ? "" : (target.get("workspace") ?? ""),
  };
}

export function accountOAuthErrorReturn(
  returnTo: string,
  provider?: "google" | "microsoft",
): string {
  const query = new URLSearchParams({ returnTo: safeAccountReturn(returnTo) });
  if (provider === "microsoft") query.set("provider", "microsoft");
  return `/?${query}`;
}
export function socialCallbackError(search: string) {
  const query = new URLSearchParams(search);
  const error = query.get("error") ?? "";
  if (
    query.get("provider") === "microsoft" &&
    ["email_not_found", "email_not_verified", "account_not_linked"].includes(
      error,
    )
  )
    return "microsoft_link_required";
  return error;
}

// Provider/callback error text is untrusted; expose only local, actionable copy.
export function accountErrorMessage(code?: string, status?: number): string {
  if (status === 429 || code === "TOO_MANY_REQUESTS")
    return "Troppi tentativi. Attendi qualche minuto e riprova.";
  switch (code) {
    case "EMAIL_NOT_VERIFIED":
      return "Verifica prima il tuo indirizzo email. Puoi richiedere un nuovo link da «Reinvia verifica email».";
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Email o password non corrette. Riprova oppure recupera la password.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Non è stato possibile creare l’account. Se hai già usato questa email, prova ad accedere o a recuperare la password.";
    case "PASSWORD_TOO_SHORT":
      return "Scegli una password di almeno 12 caratteri.";
    case "PASSWORD_TOO_LONG":
      return "La password può contenere al massimo 128 caratteri.";
    case "access_denied":
      return "Accesso annullato. Puoi riprovare o usare email e password.";
    case "account_not_linked":
      return "Accedi con il tuo metodo abituale e verifica l’indirizzo email.";
    case "microsoft_link_required":
      return "Accedi o registrati con email e password e verifica la tua casella. Poi apri «Metodi di accesso» nel tuo profilo e collega Microsoft.";
    case "email_not_found":
      return "Il servizio non ha fornito un indirizzo email. Puoi accedere con email e password.";
    case "email_not_verified":
    case "google_email_unverified":
      return "Google non ha confermato l’indirizzo email. Usa un indirizzo verificato o registrati con email e password.";
    case "account_ineligible":
      return "Questo account non può accedere. Se devi ancora verificare la tua email, richiedi un nuovo link; altrimenti contatta chi gestisce la beta.";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
    case "invalid_token":
    case "token_expired":
      return "Il link non è valido o è scaduto. Richiedi una nuova verifica email.";
    case "state_mismatch":
    case "state_not_found":
    case "state_expired":
      return "La sessione di accesso è scaduta. Riprova da questa pagina.";
    default:
      return "Accesso non riuscito. Riprova tra poco; se il problema continua, usa il recupero account.";
  }
}
