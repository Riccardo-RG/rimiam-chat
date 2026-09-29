// Only known application destinations survive an account flow; never redirect to an arbitrary caller URL.
export function safeAccountReturn(raw: string | null | undefined): string {
  if (!raw || !(raw === "/" || raw.startsWith("/?"))) return "/";
  const url = new URL(raw, "https://miriam.invalid");
  if (url.origin !== "https://miriam.invalid" || url.pathname !== "/")
    return "/";
  const invite = url.searchParams.get("invite");
  if (invite && /^[A-Za-z0-9_-]{43}$/.test(invite))
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
export function accountReturnFromSearch(search: string) {
  const params = new URLSearchParams(search);
  return safeAccountReturn(params.get("returnTo") ?? `/${search}`);
}

export function accountOAuthErrorReturn(returnTo: string): string {
  return `/?returnTo=${encodeURIComponent(safeAccountReturn(returnTo))}`;
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
      return "Accesso con Google annullato. Puoi riprovare o usare email e password.";
    case "account_not_linked":
      return "Non possiamo collegare questo accesso Google. Se hai già un account con la stessa email, accedi con la password e verifica l’indirizzo prima di riprovare.";
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
