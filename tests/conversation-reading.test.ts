import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  acceptInvitation,
  createWorkspace,
  execute,
} from "../src/server/commands";
import {
  addressedMembers,
  updateReading,
  workspaceDirectory,
} from "../src/server/conversation-reading";
import { pool, transaction } from "../src/server/db";
import { snapshot } from "../src/server/queries";

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
  return { id, email, session };
}
type Member = Awaited<ReturnType<typeof person>>;
const cmd = (p: Member, w: string, c: unknown) =>
  execute(p.id, w, randomUUID(), c, p.session);
const send = (p: Member, w: string, content: string, quoteMessageId?: string) =>
  cmd(p, w, { type: "message.send", content, quoteMessageId }).then(
    (r) => r.messageId as string,
  );
async function join(a: Member, b: Member, w: string) {
  const invite = await cmd(a, w, {
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.id, invite.token, true, b.session);
}
it("tracks only actually seen messages, protects admission and prevents a stale tab moving another device's reading point", async () => {
  const a = await person("Ada"),
    b = await person("Beatrice Riva");
  const { id: w } = await createWorkspace(a.id, "Chat", randomUUID());
  const old = await send(a, w, "Prima dell’ingresso");
  await join(a, b, w);
  const mention = await send(a, w, "@Beatrice controlli il testo?"),
    recent = await send(a, w, "È arrivato il file.");
  const { reading } = await snapshot(b.id, w);
  expect(reading.unreadIds).toEqual([mention, recent]);
  const dir = () =>
    transaction((tx) => workspaceDirectory(tx, b.id)).then((entries) =>
      entries.find((e) => e.id === w),
    );
  expect(await dir()).toMatchObject({
    preview: "È arrivato il file.",
    unreadCount: 2,
    mentionCount: 1,
    firstMentionId: mention,
  });
  const read = (
    seen: string[],
    id: string,
    expectedVersion: number,
    atBottom?: boolean,
  ) =>
    updateReading(b.id, b.session, w, {
      admission: reading.admission,
      expectedActorId: b.id,
      seen,
      anchor: { id, offset: atBottom ? 0 : 14, atBottom, expectedVersion },
    });
  await read([recent], recent, 0, true);
  await read([], old, 0);
  expect((await snapshot(b.id, w)).reading).toMatchObject({
    anchorId: recent,
    anchorAtBottom: true,
    cursorVersion: 1,
    unreadIds: [mention],
    mentionIds: [mention],
  });
  const other = await createWorkspace(a.id, "Altra", randomUUID()),
    foreign = await send(a, other.id, "Privato dello spazio");
  await expect(read([mention, foreign], recent, 1)).rejects.toThrow(
    "MESSAGE_NOT_FOUND",
  );
  expect((await dir())?.mentionCount).toBe(1);
  await read([mention], mention, 1);
  expect((await snapshot(b.id, w)).reading.anchorAtBottom).toBe(false);
  expect((await dir())?.unreadCount).toBe(0);
  await cmd(b, w, { type: "member.leave", confirmed: true });
  await join(a, b, w);
  expect((await snapshot(b.id, w)).reading).toMatchObject({
    anchorId: null,
    anchorAtBottom: false,
    cursorVersion: 0,
  });
  await expect(read([], old, 2)).rejects.toThrow("READING_ADMISSION_CHANGED");
});
it("closes only the explicitly addressed person's alert on a quoted answer or a personal acknowledgement", async () => {
  const a = await person("Ada"),
    b = await person("Matteo"),
    c = await person("Giulia");
  const { id: w } = await createWorkspace(a.id, "Riscontri", randomUUID());
  await join(a, b, w);
  await join(a, c, w);
  const question = await send(a, w, "Approfondiamo la prova?");
  await cmd(a, w, {
    type: "conversation.requestAnswer",
    messageId: question,
    recipients: [b.id, c.id],
  });
  await send(b, w, "Altro argomento");
  expect((await snapshot(b.id, w)).reading.requestIds).toEqual([question]);
  const reply = await send(b, w, "Sì, per venerdì.", question);
  const after = await snapshot(b.id, w);
  expect(after.messages.find((m) => m.id === reply)?.quoteMessageId).toBe(
    question,
  );
  expect(after.reading.requestIds).toEqual([]);
  expect((await snapshot(c.id, w)).reading.requestIds).toEqual([question]);
  await cmd(c, w, { type: "conversation.answered", messageId: question });
  expect((await snapshot(c.id, w)).reading.requestIds).toEqual([]);
  expect(after.commitments).toEqual([]);
});
it("does not turn an email address or an ambiguous given name into a personal mention", () => {
  const people = [
    { id: "a", name: "Mara Rossi" },
    { id: "b", name: "Mara Tosi" },
  ];
  expect(addressedMembers("a@Mara @Mara @Emme", people)).toEqual([]);
  expect(addressedMembers("@Mara Rossi, controlli?", people)).toEqual(["a"]);
  expect(addressedMembers("@Mara", people, ["b"])).toEqual(["b"]);
});
