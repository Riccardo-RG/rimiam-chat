import assert from "node:assert/strict";
import test from "node:test";
import {
  addresses,
  eventPayload,
  launchUrl,
  monthFrom,
  newEnvelope,
  localDay,
} from "../src/integrations/inputs.ts";

test("OAuth handoff stays on this installation, capability provider and ticket", () => {
  const origin = "https://example.test",
    base = origin + "/api/v1/integrations/google/launch";
  assert.equal(
    launchUrl(base + "?ticket=valid", origin, "google"),
    base + "?ticket=valid",
  );
  for (const value of [
    base,
    base + "#ticket=valid",
    base.replace("google", "microsoft") + "?ticket=x",
    base.replace("example.test", "other.test") + "?ticket=x",
    base.replace("https://", "https://user@") + "?ticket=x",
  ])
    assert.throws(() => launchUrl(value, origin, "google"));
});

test("calendar window and events use actual local dates", () => {
  const window = monthFrom("2026-02-01");
  assert.ok(window);
  assert.equal(localDay(new Date(window.end)), "2026-03-03");
  assert.equal(monthFrom("2026-02-31"), null);
  assert.ok(
    eventPayload("Appuntamento", "2026-11-25 09:30", "2026-11-25 10:30"),
  );
  assert.equal(
    eventPayload("Appuntamento", "2026-11-25 10:30", "2026-11-25 10:30"),
    null,
  );
  assert.equal(
    eventPayload("Appuntamento", "2026-11-31 09:30", "2026-12-01 10:30"),
    null,
  );
});
test("an empty private draft never inherits addressees, attachments or a reply target", () => {
  assert.deepEqual(addresses("one@example.test; two@example.test,\n"), [
    "one@example.test",
    "two@example.test",
  ]);
  assert.deepEqual(newEnvelope("me@example.test"), {
    sender: "me@example.test",
    kind: "new",
    subject: "",
    body: "",
    to: [],
    cc: [],
    bcc: [],
    attachments: [],
    target: null,
  });
});
