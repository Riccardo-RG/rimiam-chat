import type { nativePushPreference } from "../../../src/contracts/native-push";
import type { z } from "zod";

export type PushPreference = z.infer<typeof nativePushPreference>;
export type DevicePreference = PushPreference & {
  tokenCheck: "idle" | "checking" | "unavailable";
};

export async function inspectPushPreference(
  preference: PushPreference,
  matchesDeviceToken: (() => Promise<boolean>) | undefined,
  update: (value: DevicePreference) => void,
) {
  const saved = { ...preference, enabled: false };
  if (!preference.enabled || !matchesDeviceToken) {
    update({ ...saved, tokenCheck: "idle" });
    return;
  }

  // Opt-out and OS settings remain available while the device provider responds.
  update({ ...saved, tokenCheck: "checking" });
  let matches: boolean;
  try {
    matches = await matchesDeviceToken();
  } catch {
    update({ ...saved, tokenCheck: "unavailable" });
    return;
  }
  update({ ...preference, enabled: matches, tokenCheck: "idle" });
}
