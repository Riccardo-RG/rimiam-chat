import * as SecureStore from "expo-secure-store";
import { apiOrigin } from "./origin";
import { ApiError, createRequest } from "./api";

export interface Identity {
  id: string;
  name: string;
  email: string;
}
export interface StoredSession {
  origin: string;
  token: string;
  closing: boolean;
}
const key = "rimiam.session.v1";
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function storedSession(): Promise<StoredSession | null> {
  const text = await SecureStore.getItemAsync(key, options);
  if (!text) return null;
  const value = JSON.parse(text);
  if (
    typeof value.token !== "string" ||
    !value.token ||
    typeof value.closing !== "boolean" ||
    typeof value.origin !== "string" ||
    apiOrigin(value.origin, __DEV__) !== value.origin
  ) {
    throw new Error("Sessione locale non leggibile.");
  }
  return value;
}
export async function saveSession(session: StoredSession) {
  await SecureStore.setItemAsync(key, JSON.stringify(session), options);
}
export async function clearSession() {
  await SecureStore.deleteItemAsync(key, options);
}
export async function closeSession(session: StoredSession) {
  await saveSession({ ...session, closing: true });
  try {
    await createRequest(session.origin, session.token)(
      "/api/v1/native/session",
      { method: "DELETE" },
    );
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
  }
  await clearSession();
}
