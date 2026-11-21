import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as Browser from "expo-web-browser";
import { createRequest, post } from "../api";
import { apiOrigin } from "../origin";
import { saveSession, type Identity, type StoredSession } from "../session";
import { authReturn, nativeSocialCallback } from "./social-callback";

type Provider = "google" | "microsoft";
type Result = { session: StoredSession; user: Identity };
type Attempt = {
  origin: string;
  state: string;
  verifier: string;
  expires: number;
};
const key = "rimiam.signin.pending.v1";
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
let exchanging: Promise<Result> | null = null;

export class SocialSignInError extends Error {}

export async function beginSocial(origin: string, provider: Provider) {
  const [a, b] = await Promise.all([
    Crypto.getRandomBytesAsync(32),
    Crypto.getRandomBytesAsync(32),
  ]);
  const verifier = hex(a),
    state = hex(b);
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const challenge = digest
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const attempt: Attempt = {
    origin,
    state,
    verifier,
    expires: Date.now() + 15 * 60000,
  };
  await SecureStore.setItemAsync(key, JSON.stringify(attempt), options);
  try {
    const response = await Browser.openAuthSessionAsync(
      origin +
        "/account/native?" +
        new URLSearchParams({ provider, challenge, state }),
      nativeSocialCallback,
      { preferEphemeralSession: true },
    );
    if (response.type === "success") return await completeSocial(response.url);
    return null;
  } finally {
    await SecureStore.deleteItemAsync(key, options);
  }
}
export function completeSocial(url: string): Promise<Result> {
  if (exchanging) return exchanging;
  exchanging = exchange(url).finally(() => {
    exchanging = null;
  });
  return exchanging;
}
async function exchange(url: string): Promise<Result> {
  const raw = await SecureStore.getItemAsync(key, options);
  if (!raw)
    throw new SocialSignInError(
      "Avvia un nuovo accesso su questo dispositivo.",
    );
  const p = JSON.parse(raw) as Attempt;
  if (
    !(p.expires > Date.now()) ||
    apiOrigin(p.origin, __DEV__) !== p.origin ||
    !/^[a-f0-9]{64}$/.test(p.verifier)
  ) {
    await SecureStore.deleteItemAsync(key, options);
    throw new SocialSignInError("L’accesso è scaduto. Puoi ricominciare.");
  }
  const code = authReturn(url, p.state);
  // Only the original installation receives its verifier, never the browser or identity provider.
  try {
    const result = await createRequest(p.origin)<{
      token: string;
      user: Identity;
    }>(
      "/api/v1/native/social/exchange",
      post({ code, state: p.state, verifier: p.verifier }),
    );
    const session = { origin: p.origin, closing: false, token: result.token };
    try {
      await saveSession(session);
    } catch {
      await createRequest(p.origin, result.token)("/api/v1/native/session", {
        method: "DELETE",
      }).catch(() => undefined);
      throw new SocialSignInError(
        "Accesso non salvato in modo sicuro sul dispositivo. Riprova.",
      );
    }
    return { session, user: result.user };
  } finally {
    await SecureStore.deleteItemAsync(key, options);
  }
}
