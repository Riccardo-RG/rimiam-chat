import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import {
  openDirect,
  directCommand,
  directDirectory,
  directView,
  directFile,
} from "../src/server/direct-chat";
import { directInputSchema } from "../src/contracts/direct-chat";
import type { StructuredModel } from "../src/server/structured-llm";
afterAll(() => pool.end());
async function person(name: string) {
  const id = randomUUID(),
    session = randomUUID(),
    email = id + "@example.test";
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$2,$3,true,now(),now(),true)',
    [id, name, email],
  );
  await pool.query(
    `INSERT INTO session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval '1 day',now(),now())`,
    [session, randomUUID(), id],
  );
  return { id, session, email };
}
type Person = Awaited<ReturnType<typeof person>>;
async function setup() {
  const a = await person("Ada"),
    b = await person("Bea"),
    foreign = await person("Carlo");
  const { id: w } = await createWorkspace(a.id, "Gruppo", randomUUID());
  const i = await execute(
    a.id,
    w,
    randomUUID(),
    { type: "invitation.create", email: b.email, fullHistoryDisclosed: true },
    a.session,
  );
  await acceptInvitation(b.id, i.token, true, b.session);
  const [{ id }, same] = await Promise.all([
    openDirect(a.id, a.session, b.id),
    openDirect(b.id, b.session, a.id),
  ]);
  expect(same.id).toBe(id);
  const cmd = (p: Person, c: object, model?: StructuredModel) =>
    directCommand(
      p.id,
      p.session,
      id,
      directInputSchema.parse({ expectedActorId: p.id, ...c }),
      model,
    );
  return { a, b, foreign, id, w, cmd };
}
it("isolates messages and attachments, requires actual contacts, supports retry and never dispatches implicit AI operations", async () => {
  const { a, b, foreign, id, w, cmd } = await setup();
  await expect(openDirect(a.id, a.session, foreign.id)).rejects.toThrow(
    "PERSONAL_CONTACT_UNAVAILABLE",
  );
  expect(await directDirectory(b.id, b.session)).toEqual([]);
  const sent = randomUUID(),
    payload = {
      type: "send",
      id: sent,
      text: "@Emme /ricerca dimmi qualcosa",
      attachments: [
        {
          filename: "note.txt",
          bytesBase64: Buffer.from("Confidenziale").toString("base64"),
        },
      ],
    };
  await cmd(a, payload);
  await cmd(a, payload);
  await expect(cmd(a, { ...payload, text: "Diverso" })).rejects.toThrow(
    "COMMAND_ID_REUSED",
  );
  expect((await directDirectory(b.id, b.session))[0]).toMatchObject({
    id,
    name: "Ada",
    unreadCount: 1,
  });
  const view = await directView(b.id, b.session, id);
  expect(view.messages).toHaveLength(1);
  const file = view.messages[0].files[0];
  expect(
    (await directFile(b.id, b.session, id, file.id)).original_bytes.toString(),
  ).toBe("Confidenziale");
  await expect(directView(foreign.id, foreign.session, id)).rejects.toThrow(
    "DIRECT_CHAT_NOT_FOUND",
  );
  await expect(
    directFile(foreign.id, foreign.session, id, file.id),
  ).rejects.toThrow("DIRECT_CHAT_NOT_FOUND");
  expect(
    (
      await pool.query("SELECT FROM message WHERE workspace_id=$1 AND id=$2", [
        w,
        sent,
      ])
    ).rowCount,
  ).toBe(0);
  await cmd(b, {
    type: "read",
    seen: [sent],
    anchor: { id: sent, expectedVersion: 0, offset: 0, atBottom: true },
  });
  await cmd(b, {
    type: "read",
    seen: [],
    anchor: { id: sent, expectedVersion: 0, offset: 8 },
  });
  expect((await directView(b.id, b.session, id)).reading).toMatchObject({
    anchorId: sent,
    anchorAtBottom: true,
    cursorVersion: 1,
  });
  expect((await directView(a.id, a.session, id)).reading.anchorAtBottom).toBe(
    false,
  );
  expect((await directDirectory(b.id, b.session))[0].unreadCount).toBe(0);
  expect(
    directInputSchema.safeParse({
      ...payload,
      expectedActorId: a.id,
      attachments: [{ ...payload.attachments[0], allowModelProcessing: true }],
    }).success,
  ).toBe(false);
});
it("validates bilateral consent through dispatch and delivery; recaps remain private when consent is withdrawn", async () => {
  const { a, b, id, cmd } = await setup(),
    sent = randomUUID();
  await cmd(a, { type: "send", id: sent, text: "Proviamo venerdì." });
  const model = {
    generateJSON: vi.fn(async () => ({
      text: "Si parla di venerdì.",
      sourceIds: [sent],
    })),
  } as unknown as StructuredModel;
  const consent = (p: Person, v: number, on: boolean) =>
    cmd(p, {
      type: "consent",
      expectedVersion: v,
      enabled: on,
      id: randomUUID(),
    });
  const recap = (p: Person, m = model) =>
    cmd(p, { type: "recap", id: randomUUID() }, m);
  await consent(a, 0, true);
  await expect(recap(a)).rejects.toThrow("DIRECT_RECAP_CONSENT_REQUIRED");
  expect(model.generateJSON).not.toHaveBeenCalled();
  await consent(b, 0, true);
  await recap(a);
  expect((await directView(a.id, a.session, id)).recaps).toHaveLength(1);
  expect((await directView(b.id, b.session, id)).recaps).toEqual([]);
  const ungrounded = {
    generateJSON: async () => ({
      text: "Una conclusione senza fonte.",
      sourceIds: [randomUUID()],
    }),
  } as unknown as StructuredModel;
  await expect(recap(a, ungrounded)).rejects.toThrow("AI_OUTPUT_PARSE_ERROR");
  expect((await directView(a.id, a.session, id)).recaps).toHaveLength(1);
  const revoke = {
    generateJSON: vi.fn(async () => {
      await consent(b, 2, false);
      return { text: "Tardi", sourceIds: [sent] };
    }),
  } as unknown as StructuredModel;
  await expect(recap(a, revoke)).rejects.toThrow("DIRECT_CONSENT_STALE");
  await expect(recap(a)).rejects.toThrow("DIRECT_RECAP_CONSENT_REQUIRED");
  expect((await directView(a.id, a.session, id)).recaps).toHaveLength(1);
});
