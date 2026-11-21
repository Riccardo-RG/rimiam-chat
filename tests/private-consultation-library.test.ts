import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  acceptInvitation,
  createWorkspace,
  execute,
  openPersonalSpace,
} from "../src/server/commands";
import { pool } from "../src/server/db";
import { snapshot } from "../src/server/queries";
import { readDocument } from "../src/server/sources";
import {
  latestConsultation,
  workspaceConsultation,
} from "../src/server/private-consultation";
import type { StructuredModel } from "../src/server/structured-llm";
afterAll(() => pool.end());
async function account() {
  const id = randomUUID(),
    session = randomUUID(),
    email = id + "@example.test";
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$1,$2,true,now(),now(),true)',
    [id, email],
  );
  await pool.query(
    'INSERT INTO session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now(),now())',
    [session, randomUUID(), id],
  );
  return { id, session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
const cmd = (a: Account, w: string, input: unknown, id = randomUUID()) =>
  execute(a.id, w, id, input, a.session);
async function space(a: Account, b: Account) {
  const { id: w } = await createWorkspace(a.id, "Media", randomUUID());
  const inv = await cmd(a, w, {
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.id, inv.token, true, b.session);
  return w;
}
const file = (body: string) => ({
  filename: "taccuino.md",
  bytesBase64: Buffer.from(body).toString("base64"),
});
it("commits ordered originals with one caption and receipt, rolls back a bad batch, keeps stars personal and saves independent personal copies", async () => {
  const a = await account(),
    b = await account(),
    w = await space(a, b),
    personal = (await openPersonalSpace(b.id, b.session)).id;
  const id = randomUUID(),
    payload = {
      type: "message.send",
      content: "Le due schermate",
      attachments: [file("Prima"), file("Seconda")],
    };
  const sent = await cmd(a, w, payload, id);
  expect(await cmd(a, w, payload, id)).toEqual(sent);
  const sources = (await snapshot(b.id, w)).sources
    .filter((s) => s.shared_message_id === sent.messageId)
    .sort((x, y) => x.attachment_position - y.attachment_position);
  expect(sources.map((s) => s.content)).toEqual(["Prima", "Seconda"]);
  expect(new Set(sources.map((s) => s.document_id)).size).toBe(2);
  await expect(
    cmd(a, w, {
      ...payload,
      attachments: [file("Da annullare"), { ...file(""), filename: "bad.zip" }],
    }),
  ).rejects.toThrow();
  expect(
    (await snapshot(a.id, w)).messages.filter(
      (m) => m.content === "Le due schermate",
    ),
  ).toHaveLength(1);
  const src = sources[0].id;
  await cmd(b, w, { type: "library.favorite", sourceId: src, starred: true });
  expect(
    (await snapshot(a.id, w)).sources.find((s) => s.id === src)?.favorite,
  ).toBe(false);
  expect(
    (await snapshot(b.id, w)).sources.find((s) => s.id === src)?.favorite,
  ).toBe(true);
  const copy = await cmd(b, w, {
    type: "library.copy",
    destinationId: personal,
    sourceId: src,
  });
  await expect(
    cmd(a, w, { type: "library.copy", destinationId: personal, sourceId: src }),
  ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  expect((await snapshot(b.id, personal)).sources[0].origin_workspace_id).toBe(
    w,
  );
  await cmd(b, w, { type: "member.leave", confirmed: true });
  expect(
    (
      await readDocument(b.id, personal, copy.sourceId)
    ).original_bytes.toString(),
  ).toBe("Prima");
  expect(
    (await snapshot(b.id, personal)).sources[0].origin_workspace_id,
  ).toBeNull();
  await expect(readDocument(b.id, w, src)).rejects.toThrow(
    "WORKSPACE_ACCESS_DENIED",
  );
});
it("keeps requested recap private until shared and excludes personal targeting from the shared record", async () => {
  const a = await account(),
    b = await account(),
    w = await space(a, b);
  const sent = await cmd(a, w, {
    type: "message.send",
    content: "Prepariamo la sessione",
  });
  const anchor = sent.messageId;
  await cmd(a, w, {
    type: "conversation.requestAnswer",
    messageId: anchor,
    recipients: [b.id],
  });
  const input = {
    action: "summarize",
    kind: "recap",
    id: randomUUID(),
    expectedActorId: b.id,
    anchorId: anchor,
  } as const;
  const model = {
    generateJSON: async () => ({
      text: "È in preparazione la sessione.",
      sourceIds: [anchor],
    }),
  } as StructuredModel;
  const initial = (await snapshot(b.id, w)).messages.length;
  const result = await workspaceConsultation(b.id, b.session, w, input, model);
  expect(result.personalIds).toEqual([anchor]);
  expect(result.references[0].id).toBe(anchor);
  expect(await latestConsultation(a.id, a.session, w, "recap")).toBeNull();
  expect((await snapshot(b.id, w)).messages).toHaveLength(initial);
  const share = {
    action: "share",
    id: input.id,
    expectedActorId: b.id,
  } as const;
  const published = await workspaceConsultation(b.id, b.session, w, share);
  expect(
    (await workspaceConsultation(b.id, b.session, w, share)).sharedMessageId,
  ).toBe(published.sharedMessageId);
  expect(
    (await snapshot(a.id, w)).messages
      .filter((m) => m.id === published.sharedMessageId)
      .map((m) => m.content),
  ).toEqual([result.answer]);
  await expect(
    workspaceConsultation(a.id, a.session, w, {
      ...share,
      expectedActorId: a.id,
    }),
  ).rejects.toThrow("CONSULTATION_NOT_FOUND");
});

it("previews a generated editable document in the owner's archive and shares a distinct original only on explicit copy", async () => {
  const a = await account(),
    b = await account(),
    w = await space(a, b);
  const generation = {
    action: "document",
    id: randomUUID(),
    expectedActorId: a.id,
    kind: "document",
    question: "Prepara un documento per la beta",
  } as const;
  let calls = 0;
  const model = {
    generateJSON: async () => {
      calls++;
      return {
        answer: "# Piano beta\n\nRaccogliere due feedback.",
        keys: [],
        moreTerms: [],
      };
    },
  } as unknown as StructuredModel;
  const built = await workspaceConsultation(
    a.id,
    a.session,
    w,
    generation,
    model,
  );
  const again = await workspaceConsultation(
    a.id,
    a.session,
    w,
    generation,
    model,
  );
  expect(again.documentSourceId).toBe(built.documentSourceId);
  expect(calls).toBe(1);
  const archive = built.documentWorkspaceId!,
    source = built.documentSourceId!;
  expect(
    (await readDocument(a.id, archive, source)).original_bytes.toString(),
  ).toBe(built.answer);
  expect(
    (await snapshot(a.id, archive)).sources.find((s) => s.id === source)
      ?.origin_workspace_id,
  ).toBe(w);
  await expect(readDocument(b.id, archive, source)).rejects.toThrow(
    "WORKSPACE_ACCESS_DENIED",
  );
  expect(
    (await snapshot(b.id, w)).sources.some(
      (s) => s.filename === "Piano beta.md",
    ),
  ).toBe(false);
  await expect(
    workspaceConsultation(
      a.id,
      a.session,
      w,
      { action: "share", id: generation.id, expectedActorId: a.id },
      model,
    ),
  ).rejects.toThrow("USE_DOCUMENT_SHARING");
  const copied = await cmd(a, archive, {
    type: "library.copy",
    sourceId: source,
    destinationId: w,
  });
  expect(
    (await readDocument(b.id, w, copied.sourceId)).original_bytes.toString(),
  ).toBe(built.answer);
  expect(
    (await snapshot(b.id, w)).sources.find((s) => s.id === copied.sourceId)
      ?.origin_workspace_id,
  ).toBeNull();
  expect(copied.sourceId).not.toBe(source);
});

it("continues only the explicitly selected private Context exchange, including after resuming it", async () => {
  const a = await account(),
    b = await account(),
    w = await space(a, b);
  const captured: {
    question: string;
    previousPrivateTurns?: { question: string; answer: string }[];
  }[] = [];
  const model: StructuredModel = {
    async generateJSON({ schema, prompt }) {
      const p = JSON.parse(prompt);
      captured.push(p);
      return schema.parse({
        answer: "Lettura di " + p.question,
        keys: [],
        moreTerms: [],
      });
    },
  };
  const ask = (
    person: Account,
    workspace: string,
    question: string,
    parentId?: string,
    id: string = randomUUID(),
  ) =>
    workspaceConsultation(
      person.id,
      person.session,
      workspace,
      {
        action: "ask",
        kind: "context",
        expectedActorId: person.id,
        question,
        id,
        parentId,
      },
      model,
    );
  const resume = (person: Account, workspace: string, id: string) =>
    workspaceConsultation(person.id, person.session, workspace, {
      action: "resume",
      id,
      expectedActorId: person.id,
    });
  const initialCount = (await snapshot(a.id, w)).messages.length;
  const original = await ask(b, w, "Perché aprire il laboratorio il venerdì?");
  const unrelated = await ask(b, w, "Quanto costa la sede?");
  const next = await ask(b, w, "E perché?", original.id);
  expect(captured.at(-1)?.previousPrivateTurns).toEqual([
    { question: original.question, answer: original.answer },
  ]);
  expect(await latestConsultation(b.id, b.session, w, "context")).toEqual({
    id: next.id,
    createdAt: next.createdAt,
  });
  expect(captured[1].previousPrivateTurns).toBeUndefined();
  const reopened = await resume(b, w, next.id);
  expect(reopened.history?.map((t) => t.id)).toEqual([original.id]);
  expect(captured).toHaveLength(3);
  const third = await ask(b, w, "Tu da dove cominceresti?", reopened.id);
  expect(captured.at(-1)?.previousPrivateTurns).toEqual([
    { question: next.question, answer: next.answer },
  ]);
  expect((await resume(b, w, third.id)).history?.map((t) => t.id)).toEqual([
    original.id,
    next.id,
  ]);
  expect((await snapshot(a.id, w)).messages).toHaveLength(initialCount);
  await expect(ask(b, w, next.question, unrelated.id, next.id)).rejects.toThrow(
    "COMMAND_ID_REUSED",
  );
  await expect(ask(a, w, "Come?", next.id)).rejects.toThrow(
    "CONSULTATION_NOT_FOUND",
  );
  await expect(resume(a, w, next.id)).rejects.toThrow("CONSULTATION_NOT_FOUND");
  const other = await space(a, b);
  await expect(ask(b, other, "Come?", next.id)).rejects.toThrow(
    "CONSULTATION_NOT_FOUND",
  );
  const archive = (await openPersonalSpace(b.id, b.session)).id;
  const msg = await cmd(b, archive, {
    type: "message.send",
    content: "Altro canale privato",
  });
  await pool.query(
    "INSERT INTO personal_consultation_turn(id,thread_id,message_id,actor_id,target_id,admission,selection_version) SELECT id,$2,$3,actor_id,workspace_id,admission,1 FROM private_workspace_consultation WHERE id=$1",
    [unrelated.id, archive, msg.messageId],
  );
  await expect(ask(b, w, "Segue?", unrelated.id)).rejects.toThrow(
    "CONSULTATION_NOT_FOUND",
  );
  await expect(resume(b, w, unrelated.id)).rejects.toThrow(
    "CONSULTATION_NOT_FOUND",
  );
  await cmd(b, w, { type: "member.leave", confirmed: true });
  const invite = await cmd(a, w, {
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.id, invite.token, true, b.session);
  expect(await latestConsultation(b.id, b.session, w, "context")).toBeNull();
  await expect(ask(b, w, "Segue?", third.id)).rejects.toThrow(
    "CONSULTATION_NOT_FOUND",
  );
  expect(captured).toHaveLength(4);
});
