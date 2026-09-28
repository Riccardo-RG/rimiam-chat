import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { snapshot } from "../src/server/queries";
import { state, messages, history, receipt } from "../src/server/sync";
import { retrieveSources } from "../src/server/interpretation";

afterAll(() => pool.end());
async function person() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,\'Introduction tester\',$2,true,now(),now(),true)',
    [id, `${id}@example.test`],
  );
  return id;
}
it("atomically records an attributed introduction and one deterministic welcome; concurrent retries never establish a Goal or AI work", async () => {
  const actor = await person(),
    w = randomUUID();
  const description =
    "Vogliamo aprire un cocktail bar GINEPRO. Il nostro budget massimo è 80.000 euro. Analizza il progetto.";
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      createWorkspace(actor, "Ginepro", w, description),
    ),
  );
  expect(results).toEqual(Array(4).fill({ id: w }));
  const view = await snapshot(actor, w);
  expect(view.messages).toHaveLength(2);
  const [intro, welcome] = view.messages;
  expect(intro).toMatchObject({
    content: description,
    author_id: actor,
    actor_kind: "human",
    purpose: "workspace_introduction",
    sequence: 1,
  });
  expect(welcome).toMatchObject({
    author_id: null,
    actor_kind: "miriam",
    purpose: "workspace_welcome",
    reply_to_source_id: intro.id,
    sequence: 2,
  });
  expect(welcome.content).not.toContain("ripeti");
  expect(view.goals).toHaveLength(0);
  expect(view.adherences).toHaveLength(0);
  expect(view.information).toHaveLength(0);
  expect(view.commitments).toHaveLength(0);
  expect(view.interpretations).toHaveLength(0);
  expect(
    (await pool.query("SELECT 1 FROM active_work WHERE workspace_id=$1", [w]))
      .rowCount,
  ).toBe(0);
  expect(
    (
      await pool.query("SELECT 1 FROM miriam_response WHERE workspace_id=$1", [
        w,
      ])
    ).rowCount,
  ).toBe(0);
  expect(await retrieveSources(w, ["GINEPRO"])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: intro.id, content: description }),
    ]),
  );
  expect((await receipt(actor, w, w)).result).toEqual({ id: w });
  await expect(
    createWorkspace(actor, "Ginepro", w, "Diversa descrizione"),
  ).rejects.toThrow("COMMAND_ID_REUSED");
  await expect(createWorkspace(actor, "Ginepro", w)).rejects.toThrow(
    "COMMAND_ID_REUSED",
  );
  await expect(
    createWorkspace(await person(), "Ginepro", w, description),
  ).rejects.toThrow("COMMAND_ID_REUSED");
  await expect(
    pool.query("UPDATE message SET content='rewrite' WHERE id=$1", [intro.id]),
  ).rejects.toThrow("immutable");
});

it("retains the same welcome across admission, reload/catch-up and name-only journal replay", async () => {
  const actor = await person(),
    other = await person(),
    w = randomUUID();
  await createWorkspace(actor, "Solo nome", w);
  await createWorkspace(actor, "Solo nome", w, "  ");
  const initial = await snapshot(actor, w);
  expect(initial.messages).toHaveLength(1);
  const token = await execute(actor, w, randomUUID(), {
    type: "invitation.create",
    email: `${other}@example.test`,
    fullHistoryDisclosed: true,
  });
  await expect(state(other, w)).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  await acceptInvitation(other, token.token, true);
  const s = await state(other, w);
  const page = await messages(other, w, 0, s.messageSequence, 20);
  const old = await history(
    other,
    w,
    s.messageSequence + 1,
    s.messageSequence,
    20,
  );
  expect(old.messages).toEqual(page.messages);
  expect(page.messages).toEqual([
    expect.objectContaining({
      id: initial.messages[0].id,
      purpose: "workspace_welcome",
      authorId: "miriam",
      actorKind: "miriam",
    }),
  ]);
  const sent = await execute(other, w, randomUUID(), {
    type: "message.send",
    content: "Eccomi",
  });
  expect((await snapshot(other, w)).messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: sent.messageId,
        sequence: 2,
        purpose: "conversation",
      }),
    ]),
  );
  await createWorkspace(actor, "Solo nome", w);
  expect((await snapshot(actor, w)).messages).toHaveLength(2);
});
