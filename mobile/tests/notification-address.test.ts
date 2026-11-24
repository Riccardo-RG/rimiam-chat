import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { notificationAddress } from "../src/notifications/address.ts";

test("only accepts opaque valid notification identifiers for navigation", () => {
  const value = { id: randomUUID(), deviceId: randomUUID() };
  assert.deepEqual(
    notificationAddress({ ...value, url: "https://example.test" }),
    value,
  );
  assert.equal(
    notificationAddress({
      id: "https://example.test",
      deviceId: value.deviceId,
    }),
    null,
  );
  assert.equal(
    notificationAddress({ id: value.id, workspaceId: value.deviceId }),
    null,
  );
});

test("reads an older APNs tap from the raw push payload only when native content data is absent", () => {
  const oldAddress = { id: randomUUID(), deviceId: randomUUID() };
  const nextAddress = { id: randomUUID(), deviceId: randomUUID() };
  const legacy = { aps: { alert: "RIMIAM" }, ...oldAddress };
  assert.deepEqual(notificationAddress(null, legacy), oldAddress);
  assert.deepEqual(notificationAddress(nextAddress, legacy), nextAddress);
  assert.equal(notificationAddress({ id: "invalid" }, legacy), null);
  assert.equal(
    notificationAddress(null, {
      workspaceId: randomUUID(),
      url: "https://example.test",
    }),
    null,
  );
});
