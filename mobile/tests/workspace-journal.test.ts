import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  commandJournal,
  hiddenItemPreferences,
  journalIdentity,
} from "../src/workspace/journal.ts";
const intent = {
  kind: "command" as const,
  label: "Invia",
  command: { type: "message.send" as const, content: "🌿".repeat(2000) },
};
function fixture() {
  const rows = new Map<string, string>();
  const store = {
    get: async (k: string) => rows.get(k) ?? null,
    set: async (k: string, v: string) => {
      rows.set(k, v);
    },
    remove: async (k: string) => {
      rows.delete(k);
    },
  };
  return { store, rows, journal: commandJournal(store, randomUUID) };
}
test("pending material is isolated by service, actor, space, direct chat and call safety lane", () => {
  const base = {
    origin: "https://example.test",
    actorId: "a",
    workspaceId: "w",
  };
  assert.equal(
    new Set(
      [
        base,
        { ...base, actorId: "b" },
        { ...base, origin: "https://example.org" },
        { ...base, workspaceId: "z" },
        { ...base, directId: "w" },
        { ...base, lane: "call-exit" as const },
      ].map(journalIdentity),
    ).size,
    6,
  );
});
test("restart retains exact unicode payload and command identity until confirmation", async () => {
  const { rows, journal, store } = fixture();
  const saved = await journal.write("a", intent);
  for (const part of rows.values()) assert.ok(Buffer.byteLength(part) < 2048);
  const restarted = commandJournal(store, randomUUID);
  assert.deepEqual(await restarted.read("a"), saved);
  await assert.rejects(restarted.write("a", intent), /precedente/);
  await assert.rejects(
    restarted.clear("a", { ...saved, id: randomUUID() }),
    /cambiato/,
  );
  await restarted.clear("a", saved);
  assert.equal(rows.size, 0);
});
test("two concurrent composers cannot replace each other’s unconfirmed operation", async () => {
  const { journal } = fixture();
  const results = await Promise.allSettled([
    journal.write("a", intent),
    journal.write("a", intent),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("partial secure storage failures leave no published command, and corrupt chunks are reported", async () => {
  const { rows, store } = fixture();
  const broken = commandJournal(
    {
      ...store,
      set: async (k, v) => {
        if (k.endsWith(".2")) throw new Error();
        await store.set(k, v);
      },
    },
    randomUUID,
  );
  await assert.rejects(broken.write("a", intent), /proteggere/);
  assert.equal(rows.size, 0);
  const good = commandJournal(store, randomUUID);
  const pending = await good.write("a", intent);
  rows.delete("a." + pending.id + ".1");
  await assert.rejects(good.read("a"), /incompleto/);
});

test("editing an unsent draft replaces the last generation atomically and preserves other conversations", async () => {
  const { store, rows } = fixture();
  const { secureJournal } = await import("../src/workspace/journal.ts");
  const edits = secureJournal<{ token: string; text: string }>(
    store,
    randomUUID,
  );
  await edits.replace("draft.a", { token: "old", text: "prima" });
  await edits.replace("draft.b", { token: "other", text: "privato" });
  const broken = secureJournal<{ token: string; text: string }>(
    {
      ...store,
      set: async (key, value) => {
        if (key === "draft.a") throw new Error("Keychain");
        await store.set(key, value);
      },
    },
    randomUUID,
  );
  await assert.rejects(
    broken.replace("draft.a", { token: "failed", text: "x".repeat(3000) }),
  );
  assert.equal((await edits.read("draft.a"))?.intent.text, "prima");
  await Promise.all([
    edits.replace("draft.a", { token: "new", text: "aggiornata" }),
    edits.clearMatching("draft.a", (v) => v.token === "old"),
  ]);
  assert.equal((await edits.read("draft.a"))?.intent.text, "aggiornata");
  await edits.clearMatching("draft.a", (v) => v.token === "new");
  assert.equal(await edits.read("draft.a"), null);
  assert.equal((await edits.read("draft.b"))?.intent.text, "privato");
  assert.ok([...rows.keys()].every((k) => k.startsWith("draft.b")));
});

test("hidden library entries persist per service, account and space, and restore individually", async () => {
  const { store, rows } = fixture();
  const preferences = hiddenItemPreferences(store, randomUUID);
  const scope = {
    origin: "https://example.test",
    actorId: "ada",
    workspaceId: "group",
  };
  const key = journalIdentity(scope);
  const changedKeys = [
    { ...scope, origin: "https://other.test" },
    { ...scope, actorId: "matteo" },
    { ...scope, workspaceId: "private" },
  ].map(journalIdentity);
  const link = "link:message:page",
    photo = "file:photo";
  await Promise.all([
    preferences.set(key, link, true),
    preferences.set(key, photo, true),
  ]);
  for (const otherKey of changedKeys)
    assert.deepEqual(await preferences.read(otherKey), []);
  const restarted = hiddenItemPreferences(store, randomUUID);
  assert.deepEqual(await restarted.read(key), [link, photo]);
  assert.deepEqual(await restarted.set(key, photo, true), [link, photo]);
  assert.deepEqual(await restarted.set(key, photo, false), [link]);
  assert.deepEqual(await restarted.set(key, link, false), []);
  assert.equal(rows.size, 0);
});
