import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool, transaction } from "../src/server/db";
import { createWorkspace, execute } from "../src/server/commands";
import { attentionView, organizeSources } from "../src/server/attention";
import { lockWorkspace } from "../src/server/workspace-state";
afterAll(() => pool.end());
async function setup() {
  const actor = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,\'Attention tester\',$2,true,now(),now(),true)',
    [actor, `${actor}@example.test`],
  );
  const w = (await createWorkspace(actor, "Attention", randomUUID())).id;
  return { actor, w };
}
it("keeps personal alignment separate from consent and excludes private operation hints", async () => {
  const { actor, w } = await setup();
  await execute(actor, w, randomUUID(), {
    type: "goal.establish",
    content: "Capire il nostro quartiere",
  });
  const first = await attentionView(actor, w);
  expect(first.preference).toMatchObject({
    version: 0,
    mode: "discreet",
    actor: null,
  });
  expect(first.changes.some((c) => c.kind === "goal.establish")).toBe(true);
  await execute(actor, w, randomUUID(), {
    type: "attention.aligned",
    revision: first.revision,
  });
  expect((await attentionView(actor, w)).changes).toHaveLength(0);
  expect(
    (
      await pool.query("SELECT * FROM goal_adherence WHERE workspace_id=$1", [
        w,
      ])
    ).rowCount,
  ).toBe(0);
  await expect(
    execute(actor, w, randomUUID(), {
      type: "attention.aligned",
      revision: first.revision + 100,
    }),
  ).rejects.toThrow("STATE_REVISION_INVALID");
});
it("groups original sources without duplication, preserves removal and rejects foreign source links", async () => {
  const { actor, w } = await setup();
  const other = await setup();
  const m = await execute(actor, w, randomUUID(), {
    type: "message.send",
    content: "La biblioteca ospita incontri il sabato",
  });
  await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await organizeSources(tx, w, m.messageId, [
      { title: "Luoghi", sourceIds: [m.messageId] },
      { title: "Incontri", sourceIds: [m.messageId] },
    ]);
  });
  const view = await attentionView(actor, w);
  expect(view.workstreams).toHaveLength(2);
  const stream = view.workstreams[0];
  await execute(actor, w, randomUUID(), {
    type: "workstream.link",
    workstreamId: stream.id,
    sourceId: m.messageId,
    expectedVersion: 1,
    included: false,
  });
  await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await organizeSources(tx, w, m.messageId, [
      { title: stream.title, sourceIds: [m.messageId] },
    ]);
  });
  expect(
    (await attentionView(actor, w)).workstreams.find((s) => s.id === stream.id)
      ?.sources[0].included,
  ).toBe(false);
  expect(
    (await pool.query("SELECT * FROM message WHERE workspace_id=$1", [w]))
      .rowCount,
  ).toBe(1);
  const foreign = await execute(other.actor, other.w, randomUUID(), {
    type: "message.send",
    content: "Private separate space",
  });
  await expect(
    execute(actor, w, randomUUID(), {
      type: "workstream.link",
      workstreamId: stream.id,
      sourceId: foreign.messageId,
      expectedVersion: 0,
      included: true,
    }),
  ).rejects.toThrow("WORKSTREAM_SOURCE_NOT_FOUND");
  await expect(attentionView(other.actor, w)).rejects.toThrow(
    "WORKSPACE_ACCESS_DENIED",
  );
});
it("versions editorial names and preferences with stale checks; no authority is acquired", async () => {
  const { actor, w } = await setup();
  const s = await execute(actor, w, randomUUID(), {
    type: "workstream.save",
    title: "Idee",
    description: "",
  });
  await execute(actor, w, randomUUID(), {
    type: "workstream.save",
    id: s.id,
    expectedVersion: 1,
    title: "Idee per sabato",
    description: "Filone aperto",
  });
  await expect(
    execute(actor, w, randomUUID(), {
      type: "workstream.save",
      id: s.id,
      expectedVersion: 1,
      title: "Stale",
      description: "",
    }),
  ).rejects.toThrow("STATE_STALE");
  await execute(actor, w, randomUUID(), {
    type: "attention.preference",
    expectedVersion: 0,
    mode: "discreet",
  });
  await expect(
    execute(actor, w, randomUUID(), {
      type: "attention.preference",
      expectedVersion: 0,
      mode: "proactive",
    }),
  ).rejects.toThrow("STATE_STALE");
  const view = await attentionView(actor, w);
  expect(view.preference.mode).toBe("discreet");
  expect(view.workstreams[0].history).toHaveLength(2);
  expect(
    (await pool.query("SELECT * FROM project_act WHERE workspace_id=$1", [w]))
      .rowCount,
  ).toBe(0);
  await expect(
    pool.query(
      "UPDATE workstream_version SET title='rewrite' WHERE workspace_id=$1",
      [w],
    ),
  ).rejects.toThrow("immutable");
});
