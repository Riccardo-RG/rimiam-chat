export const nativeSocialCallback = "com.rimiam.chat:/oauth/complete";
export function authReturn(raw: string, expectedState: string) {
  const url = new URL(raw),
    expected = new URL(nativeSocialCallback);
  if (
    url.protocol !== expected.protocol ||
    url.host !== expected.host ||
    url.pathname !== expected.pathname ||
    url.username ||
    url.password ||
    url.hash ||
    !/^[a-f0-9]{64}$/.test(expectedState) ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("state") !== expectedState
  )
    throw new Error(
      "L’accesso non appartiene a questa richiesta. Avvialo di nuovo dall’app.",
    );
  if (url.searchParams.has("error"))
    throw new Error("Accesso non completato dal servizio di identità.");
  const codes = url.searchParams.getAll("code");
  if (codes.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(codes[0]))
    throw new Error("Il codice di accesso non è valido.");
  return codes[0];
}
