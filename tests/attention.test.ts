import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool, transaction } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { attentionView, organizeSources } from "../src/server/attention";
import { lockWorkspace } from "../src/server/workspace-state";
import { messages } from "../src/server/sync";
import { workspaceDirectory } from "../src/server/conversation-reading";
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
it("keeps exact attributable topic changes on the timeline without a chat alert or independent human evidence", async () => {
  const a = await setup(),
    b = await setup();
  const invite = await execute(a.actor, a.w, randomUUID(), {
    type: "invitation.create",
    email: `${b.actor}@example.test`,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.actor, String(invite.token), true);
  const before = await transaction((tx) => workspaceDirectory(tx, b.actor));
  const submit = (actor: string, c: unknown, key = randomUUID()) =>
    execute(actor, a.w, key, c);
  const t = await submit(a.actor, {
    type: "workstream.save",
    title: "Design",
    description: "",
  });
  await submit(b.actor, {
    type: "workstream.save",
    id: t.id,
    expectedVersion: 1,
    title: "Ricerca",
    description: "",
  });
  const transition = (
    action: string,
    expectedVersion: number,
    key = randomUUID(),
  ) =>
    submit(
      a.actor,
      {
        type: "workstream.transition",
        workstreamId: t.id,
        expectedVersion,
        action,
      },
      key,
    );
  const key = randomUUID();
  await Promise.all([
    transition("archive", 2, key),
    transition("archive", 2, key),
  ]);
  await expect(transition("restore", 2)).rejects.toThrow("STATE_STALE");
  expect((await transition("restore", 3)).state).toBe("active");
  const rows = (await messages(b.actor, a.w, 0, 100, 100)).messages.filter(
    (m) => m.purpose === "workstream_event",
  );
  expect(rows).toHaveLength(4);
  expect(
    rows.map((m) => [
      m.actorKind,
      m.authorId,
      m.reference?.kind,
      m.reference?.id,
      m.reference?.version,
    ]),
  ).toEqual(
    [a.actor, b.actor, a.actor, a.actor].map((actor, i) => [
      "human",
      actor,
      "workstream",
      t.id,
      i + 1,
    ]),
  );
  expect(rows.map((m) => m.content)).toEqual([
    "ha creato l’argomento «Design».",
    "ha modificato l’argomento «Ricerca».",
    "ha archiviato l’argomento «Ricerca».",
    "ha ripristinato l’argomento «Ricerca».",
  ]);
  const after = await transaction((tx) => workspaceDirectory(tx, b.actor));
  const entry = (list: typeof before) => list.find((s) => s.id === a.w);
  expect(entry(after)).toEqual(entry(before));
  const ids = rows.map((m) => m.id);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM workspace_source WHERE id=ANY($1::uuid[])",
        [ids],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM interpretation WHERE source_id=ANY($1::uuid[])",
        [ids],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM web_push_delivery WHERE workspace_id=$1",
        [a.w],
      )
    ).rowCount,
  ).toBe(0);
});
it("restores directly archived AI suggestions to proposed after another human edit while archived", async () => {
  const { actor, w } = await setup();
  const source = await execute(actor, w, randomUUID(), {
    type: "message.send",
    content: "Ricerca clienti",
  });
  await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await organizeSources(tx, w, source.messageId, [
      { title: "Clienti", sourceIds: [source.messageId] },
    ]);
  });
  const t = (await attentionView(actor, w)).workstreams[0];
  const transition = (action: string, version: number) =>
    execute(actor, w, randomUUID(), {
      type: "workstream.transition",
      workstreamId: t.id,
      expectedVersion: version,
      action,
    });
  await transition("archive", 1);
  await execute(actor, w, randomUUID(), {
    type: "workstream.save",
    id: t.id,
    expectedVersion: 2,
    title: "Clienti",
    description: "Per dopo",
  });
  expect((await transition("restore", 3)).state).toBe("proposed");
  expect(
    (await attentionView(actor, w)).workstreams[0].sources.map((s) => s.id),
  ).toEqual([source.messageId]);
});
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
  ).toBe(2);
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

it("versions shared lifecycle acts, preserves sources and rejects stale, foreign or ended contributions", async () => {
  const { actor, w } = await setup(),
    peer = await setup();
  const invite = await execute(actor, w, randomUUID(), {
    type: "invitation.create",
    email: `${peer.actor}@example.test`,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(peer.actor, invite.token, true);
  const stream = await execute(actor, w, randomUUID(), {
    type: "workstream.save",
    title: "Trovare il locale",
    description: "Esplorazione",
  });
  const message = await execute(actor, w, randomUUID(), {
    type: "message.send",
    content: "Valutiamo anche il quartiere nord",
  });
  await execute(actor, w, randomUUID(), {
    type: "workstream.link",
    workstreamId: stream.id,
    sourceId: message.messageId,
    expectedVersion: 0,
    included: true,
  });
  const goal = await execute(actor, w, randomUUID(), {
    type: "goal.establish",
    content: "Aprire un locale",
  });
  const before = (
    await pool.query(
      "SELECT context_revision,access_revision FROM workspace WHERE id=$1",
      [w],
    )
  ).rows[0];
  const transition = (
    who: string,
    action: string,
    expectedVersion: number,
    commandId = randomUUID(),
  ) =>
    execute(who, w, commandId, {
      type: "workstream.transition",
      workstreamId: stream.id,
      action,
      expectedVersion,
    });
  const id = randomUUID();
  const resolved = await transition(peer.actor, "resolve", 1, id);
  expect(resolved).toMatchObject({
    id: stream.id,
    state: "resolved",
    version: 2,
  });
  expect(await transition(peer.actor, "resolve", 1, id)).toEqual(resolved);
  await expect(transition(actor, "resolve", 1)).rejects.toThrow("STATE_STALE");
  await expect(transition(actor, "activate", 2)).rejects.toThrow(
    "WORKSTREAM_TRANSITION_INVALID",
  );
  await transition(actor, "archive", 2);
  let view = await attentionView(peer.actor, w);
  expect(view.workstreams[0]).toMatchObject({ state: "archived", version: 3 });
  expect(view.workstreams[0].sources[0]).toMatchObject({
    id: message.messageId,
    included: true,
  });
  expect(view.workstreams[0].history[1]).toMatchObject({
    actor: peer.actor,
    lifecycleState: "resolved",
    lifecycleAction: "resolve",
  });
  await execute(actor, w, randomUUID(), {
    type: "workstream.save",
    id: stream.id,
    expectedVersion: 3,
    title: "Trovare il locale",
    description: "Nota storica",
  });
  expect((await attentionView(actor, w)).workstreams[0].state).toBe("archived");
  const newSource = await execute(actor, w, randomUUID(), {
    type: "message.send",
    content: "Nuova osservazione",
  });
  await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await organizeSources(tx, w, newSource.messageId, [
      { title: "Trovare il locale", sourceIds: [newSource.messageId] },
    ]);
  });
  view = await attentionView(actor, w);
  expect(view.workstreams).toHaveLength(1);
  expect(view.workstreams[0].sources).toHaveLength(1);
  const race = await Promise.allSettled([
    transition(actor, "reopen", 4),
    transition(peer.actor, "reopen", 4),
  ]);
  expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await attentionView(actor, w)).workstreams[0]).toMatchObject({
    id: stream.id,
    state: "active",
    version: 5,
  });
  expect(
    (
      await pool.query("SELECT current_version FROM goal WHERE id=$1", [
        goal.goalId,
      ])
    ).rows[0].current_version,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT context_revision,access_revision FROM workspace WHERE id=$1",
        [w],
      )
    ).rows[0],
  ).toEqual(before);
  expect(
    (await pool.query("SELECT 1 FROM project_act WHERE workspace_id=$1", [w]))
      .rowCount,
  ).toBe(0);
  await expect(
    execute(peer.actor, peer.w, randomUUID(), {
      type: "workstream.transition",
      workstreamId: stream.id,
      expectedVersion: 5,
      action: "resolve",
    }),
  ).rejects.toThrow("WORKSTREAM_NOT_FOUND");
  await pool.query(
    "UPDATE membership SET contributes=false WHERE workspace_id=$1 AND user_id=$2",
    [w, peer.actor],
  );
  await expect(transition(peer.actor, "resolve", 5)).rejects.toThrow();
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [
    peer.actor,
  ]);
  await expect(attentionView(peer.actor, w)).rejects.toThrow();
});

it("keeps AI groupings proposed until an explicit version-bound activation, without consuming old sources", async () => {
  const { actor, w } = await setup();
  const m = await execute(actor, w, randomUUID(), {
    type: "message.send",
    content: "Tre opzioni per i fornitori",
  });
  await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await organizeSources(tx, w, m.messageId, [
      { title: "Fornitori", sourceIds: [m.messageId] },
    ]);
  });
  let stream = (await attentionView(actor, w)).workstreams[0];
  expect(stream).toMatchObject({
    state: "proposed",
    origin: "miriam",
    actor: null,
    version: 1,
  });
  await execute(actor, w, randomUUID(), {
    type: "workstream.save",
    id: stream.id,
    expectedVersion: 1,
    title: "Fornitori",
    description: "Correggo solo il titolo/descrizione",
  });
  expect((await attentionView(actor, w)).workstreams[0].state).toBe("proposed");
  await execute(actor, w, randomUUID(), {
    type: "workstream.transition",
    workstreamId: stream.id,
    expectedVersion: 2,
    action: "activate",
  });
  stream = (await attentionView(actor, w)).workstreams[0];
  expect(stream).toMatchObject({ state: "active", actor, version: 3 });
  expect(stream.history[2]).toMatchObject({
    origin: "miriam",
    actor: null,
    lifecycleState: "proposed",
  });
  expect(stream.sources[0].id).toBe(m.messageId);
  await expect(
    pool.query(
      "UPDATE workstream_version SET lifecycle_state='archived' WHERE workspace_id=$1",
      [w],
    ),
  ).rejects.toThrow("immutable");
});
