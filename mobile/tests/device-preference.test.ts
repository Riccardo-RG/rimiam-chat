import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inspectPushPreference,
  type DevicePreference,
} from "../src/notifications/device-preference.ts";

const subscribed = {
  configured: true,
  deviceId: "test-device",
  optedIn: true,
  enabled: true,
};

test("keeps opt-out available while checking a token and when the provider fails", async () => {
  const states: DevicePreference[] = [];
  const check = inspectPushPreference(
    subscribed,
    async () => {
      throw Error("provider unavailable");
    },
    (state) => states.push(state),
  );
  const saved = { ...subscribed, enabled: false };
  assert.deepEqual(states, [{ ...saved, tokenCheck: "checking" }]);
  await check;
  assert.deepEqual(states[1], { ...saved, tokenCheck: "unavailable" });
});

test("only a matching token can mark an enabled device as active", async () => {
  for (const matches of [true, false, undefined]) {
    const states: DevicePreference[] = [];
    await inspectPushPreference(
      subscribed,
      matches === undefined ? undefined : async () => matches,
      (state) => states.push(state),
    );
    assert.deepEqual(states.at(-1), {
      ...subscribed,
      enabled: matches === true,
      tokenCheck: "idle",
    });
  }
});

test("a disabled preference does not ask the provider for a token", async () => {
  const disabled = { ...subscribed, optedIn: false, enabled: false };
  const states: DevicePreference[] = [];
  let calls = 0;
  await inspectPushPreference(
    disabled,
    async () => {
      calls++;
      return true;
    },
    (state) => states.push(state),
  );
  assert.equal(calls, 0);
  assert.deepEqual(states, [{ ...disabled, tokenCheck: "idle" }]);
});
