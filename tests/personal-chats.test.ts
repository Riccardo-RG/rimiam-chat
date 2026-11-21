import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { generateVAPIDKeys } from "web-push";
import { setPushPreference, pushDeliveryTarget } from "../src/server/web-push";
import { admitAIInvocation } from "../src/server/ai-admission";
import { pool } from "../src/server/db";
import {
  acceptInvitation,
  createWorkspace,
  execute,
  openPersonalSpace,
} from "../src/server/commands";
import {
  chatDirectory,
  personalChatAct,
  personalChatState,
} from "../src/server/personal-chats";
import {
  latestConsultation,
  workspaceConsultation,
} from "../src/server/private-consultation";
import { processResearch } from "../src/server/research";
import { processPersonalBrief } from "../src/server/personal-research";
import { listWorkspaces, snapshot } from "../src/server/queries";
import type { StructuredModel } from "../src/server/structured-llm";
import type { PersonalChatInput } from "../src/contracts/personal-chats";
import { chatStateSchema } from "../src/contracts/personal-chats";
afterEach(() => vi.unstubAllEnvs());
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
type Person = Awaited<ReturnType<typeof account>>;
const send = (p: Person, w: string, c: unknown) =>
  execute(p.id, w, randomUUID(), c, p.session);
const act = (p: Person, c: PersonalChatInput, m?: StructuredModel) =>
  personalChatAct(p.id, p.session, c, m);
const view = (p: Person, w: string) => personalChatState(p.id, p.session, w);
const dir = (p: Person, q = "") => chatDirectory(p.id, p.session, q);
const fresh = (p: Person, w: string) =>
  act(p, { action: "new", thread: w, expectedActorId: p.id });
it("resumes independent chats, searches voluntarily, keeps a unique archive and refuses cross-account access and workspace capabilities", async () => {
  const a = await account(),
    b = await account(),
    w = randomUUID(),
    v = randomUUID();
  const [first, second] = await Promise.all([fresh(a, w), fresh(a, w)]);
  expect(first).toEqual(second);
  const archive = (await openPersonalSpace(a.id, a.session)).id;
  expect((await dir(a)).active).toBe(w);
  await send(a, w, {
    type: "message.send",
    content: "Preventivo privato di ieri",
  });
  await fresh(a, v);
  expect((await dir(a)).active).toBe(v);
  expect((await dir(a, "preventivo")).threads.map((r) => r.id)).toEqual([w]);
  expect(
    (await snapshot(a.id, v)).messages.filter(
      (m) => m.purpose !== "workspace_welcome",
    ),
  ).toHaveLength(0);
  expect((await openPersonalSpace(a.id, a.session)).id).toBe(archive);
  expect(await listWorkspaces(a.id)).toEqual([]);
  expect((await view(a, w)).archive).toBe(archive);
  await expect(
    act(b, { action: "open", thread: w, expectedActorId: b.id }),
  ).rejects.toThrow("PERSONAL_CHAT_UNAVAILABLE");
  await expect(view(b, w)).rejects.toThrow("PERSONAL_CHAT_UNAVAILABLE");
  await expect(
    send(a, w, {
      type: "invitation.create",
      email: b.email,
      fullHistoryDisclosed: true,
    }),
  ).rejects.toThrow("PERSONAL_SPACE_UNSUPPORTED");
  await expect(
    send(a, w, {
      type: "followup.create",
      kind: "remember",
      reference: null,
      content: "Wrong target",
      remindAt: "2035-11-08T09:00:00Z",
      timeZone: "UTC",
    }),
  ).rejects.toThrow("PERSONAL_SPACE_UNSUPPORTED");
  await act(a, { action: "open", thread: w, expectedActorId: a.id });
  expect((await dir(a)).active).toBe(w);
});
it("consults only an explicitly selected visible group, keeps private answers out of the workspace and blocks stale delivery after Termina or departure", async () => {
  const a = await account(),
    b = await account(),
    thread = randomUUID();
  await fresh(a, thread);
  const { id: w } = await createWorkspace(b.id, "Progetto", randomUUID());
  const select = (target: string | null, version: number) =>
    act(a, {
      action: "select",
      target,
      thread,
      expectedActorId: a.id,
      expectedVersion: version,
    });
  await expect(select(w, 0)).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  const inv = await send(b, w, {
    type: "invitation.create",
    email: a.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(a.id, inv.token, true, a.session);
  await send(b, w, {
    type: "message.send",
    content: "Preventivo 450 euro per la grafica.",
  });
  await select(w, 0);
  const question = "Quanto costa il preventivo?",
    request = {
      action: "ask",
      thread,
      expectedActorId: a.id,
      expectedVersion: 1,
      id: randomUUID(),
      question,
      target: w,
    } as const;
  const model: StructuredModel = {
    async generateJSON({ prompt, schema }) {
      expect(prompt).toContain("450 euro");
      const ev = JSON.parse(prompt).evidence;
      return schema.parse({
        answer: "450 euro secondo Matteo.",
        keys: [
          ev.find((s: { content: string }) => s.content.includes("450 euro"))
            .key,
        ],
        moreTerms: [],
      });
    },
  };
  await act(a, request, model);
  await act(a, request, model);
  const s = chatStateSchema.parse(await view(a, thread));
  expect(s.turns).toHaveLength(1);
  expect(s.turns[0].answer).toMatch(/450/);
  expect(
    (await snapshot(b.id, w)).messages.map((m) => m.content),
  ).not.toContain(question);
  expect(await latestConsultation(a.id, a.session, w, "context")).toBeNull();
  await expect(
    workspaceConsultation(a.id, a.session, w, {
      action: "share",
      id: request.id,
      expectedActorId: a.id,
    }),
  ).rejects.toThrow("PRIVATE_CHAT_RESULT");
  const race = {
    ...request,
    id: randomUUID(),
    question: "Qual è il preventivo concordato?",
  };
  const interrupt: StructuredModel = {
    async generateJSON({ schema }) {
      await select(null, 1);
      return schema.parse({
        answer: "Non pubblicabile",
        keys: [],
        moreTerms: [],
      });
    },
  };
  await expect(act(a, race, interrupt)).rejects.toThrow(
    "CONSULTATION_SELECTION_CHANGED",
  );
  expect(
    (await view(a, thread)).turns.find((t) => t.id === race.id)?.answer,
  ).toBeNull();
  await send(a, w, { type: "member.leave", confirmed: true });
  expect(
    (await view(a, thread)).turns.find((t) => t.id === request.id),
  ).toMatchObject({ status: "unavailable", answer: null, references: [] });
});
it("searches only the exact authorized query, verifies citations, keeps research private and shares a single reviewed result on explicit command", async () => {
  const a = await account(),
    b = await account(),
    thread = randomUUID();
  await fresh(a, thread);
  const { id: w } = await createWorkspace(a.id, "Review", randomUUID());
  const invite = await send(a, w, {
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.id, invite.token, true, b.session);
  const query = "Quali strumenti usano i piccoli team?",
    request = await send(a, thread, {
      type: "research.private_request",
      query,
      discloseQuery: true,
      analyzeExcerpts: true,
      notify: false,
    });
  const id = request.workId as string;
  await processResearch(id, {
    name: "test",
    async search(exact) {
      expect(exact).toBe(query);
      return [
        {
          title: "Rapporto",
          url: "https://example.org/report",
          excerpt: "Ricerca pubblica sulle scelte dei piccoli team.",
        },
      ];
    },
  });
  const malformed: StructuredModel = {
    async generateJSON({ schema }) {
      return schema.parse({ summary: "Un dato", sources: [randomUUID()] });
    },
  };
  await processPersonalBrief(thread, id, 1, malformed);
  expect((await view(a, thread)).research[0]).toMatchObject({
    brief: true,
    status: "failed",
    summary: null,
  });
  await send(a, thread, {
    type: "research.brief_retry",
    workId: id,
    generation: 1,
  });
  const model: StructuredModel = {
    async generateJSON({ schema, prompt }) {
      const { sources } = JSON.parse(prompt);
      return schema.parse({
        summary: "Il rapporto descrive i piccoli team.",
        sources: [sources[0].id],
      });
    },
  };
  await processPersonalBrief(thread, id, 1, model);
  await processPersonalBrief(thread, id, 1, model);
  const s = chatStateSchema.parse(await view(a, thread));
  expect(s.research[0]).toMatchObject({
    status: "ready",
    read: false,
    notify: false,
  });
  expect(s.research[0].citations[0].url).toBe("https://example.org/report");
  expect((await dir(a)).ready).toEqual({ thread, workId: id });
  expect((await dir(b)).ready).toBeNull();
  expect(
    (await snapshot(b.id, w)).messages.filter((m) =>
      m.content.includes("Il rapporto"),
    ),
  ).toEqual([]);
  await expect(
    send(b, thread, {
      type: "research.private_publish",
      workId: id,
      generation: 1,
      destinationId: w,
    }),
  ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  await act(a, {
    action: "research_read",
    workId: id,
    thread,
    expectedActorId: a.id,
  });
  expect((await dir(a)).ready).toBeNull();
  const pub = {
      type: "research.private_publish",
      workId: id,
      generation: 1,
      destinationId: w,
    },
    first = await send(a, thread, pub);
  expect((await send(a, thread, pub)).messageId).toBe(first.messageId);
  expect(
    (await snapshot(b.id, w)).messages.filter((m) =>
      m.content.includes("Il rapporto"),
    ),
  ).toHaveLength(1);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM web_push_delivery WHERE kind='personal_research' AND reference_id=$1",
        [id],
      )
    ).rowCount,
  ).toBe(0);
});

it("retains one account budget across thread creation and enforces both device consent and the opt-in for each research", async () => {
  const a = await account(),
    w = randomUUID(),
    v = randomUUID();
  await fresh(a, w);
  await fresh(a, v);
  vi.stubEnv("AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY", "1");
  await admitAIInvocation("private_research", w);
  await expect(admitAIInvocation("conversation", v)).rejects.toThrow(
    "AI_USAGE_LIMIT_REACHED",
  );
  const keys = generateVAPIDKeys();
  vi.stubEnv("WEB_PUSH_ENABLED", "true");
  vi.stubEnv("WEB_PUSH_VAPID_SUBJECT", "mailto:beta@example.test");
  vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", keys.publicKey);
  vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", keys.privateKey);
  await setPushPreference(a.id, a.session, {
    operation: "enable",
    expectedActorId: a.id,
    expectedSessionId: a.session,
    workspaceId: w,
    consent: true,
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/" + randomUUID(),
      keys: {
        p256dh: generateVAPIDKeys().publicKey,
        auth: randomBytes(16).toString("base64url"),
      },
    },
  });
  const run = async (notify: boolean) => {
    const r = await send(a, w, {
      type: "research.private_request",
      query: "Domanda di prova",
      discloseQuery: true,
      analyzeExcerpts: true,
      notify,
    });
    const id = r.workId as string;
    await processResearch(id, { name: "test", search: async () => [] });
    await processPersonalBrief(w, id, 1);
    const out = (
      await pool.query(
        "SELECT id,device_id FROM web_push_delivery WHERE workspace_id=$1 AND reference_id=$2 AND kind='personal_research'",
        [w, id],
      )
    ).rows;
    return { id, out };
  };
  expect((await run(false)).out).toHaveLength(0);
  const ready = await run(true);
  expect(ready.out).toHaveLength(1);
  const d = ready.out[0];
  expect(
    (await pushDeliveryTarget(a.id, a.session, d.id, d.device_id)).url,
  ).toContain(w);
  await act(a, {
    action: "research_read",
    workId: ready.id,
    thread: w,
    expectedActorId: a.id,
  });
  await expect(
    pushDeliveryTarget(a.id, a.session, d.id, d.device_id),
  ).rejects.toThrow("PUSH_DELIVERY_UNAVAILABLE");
});
