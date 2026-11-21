import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { pool } from "../src/server/db";
import {
  acceptInvitation,
  createWorkspace,
  execute,
  openPersonalSpace,
} from "../src/server/commands";
import { processInterpretation } from "../src/server/interpretation";
import { snapshot } from "../src/server/queries";
import { assistantRequestFailures } from "../src/shared/assistant-request-failures";
import { DomainError } from "../src/server/errors";
import {
  readAssistantSettings,
  saveAssistantSettings,
} from "../src/server/assistant-settings";
import { assistantConnectionRevision } from "../src/server/assistant-connections";
import { saveAssistantSettingsSchema } from "../src/contracts/assistant-settings";

afterAll(() => pool.end());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function person() {
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
const entry = {
  kind: "agent",
  id: "researchdesk",
  label: "Research Desk",
  url: "https://agent.example.test/contribute",
  readOnly: true,
};
const local = {
  kind: "model",
  id: "deskmodel",
  provider: "ollama",
  model: "desk",
  label: "Desk",
  baseURL: "http://localhost:11434",
};
function register(url = entry.url) {
  vi.stubEnv(
    "RIMIAM_ASSISTANT_CONNECTIONS",
    JSON.stringify([{ ...entry, url }, local]),
  );
}
type Person = Awaited<ReturnType<typeof person>>;
const view = (p: Person, w?: string) =>
  readAssistantSettings(p.id, p.session, w);
const save = (
  p: Person,
  w: string | undefined,
  rev: number,
  connectionId: string,
  displayName = "Iris",
  instructions = "Keep answers short.",
) =>
  saveAssistantSettings(p.id, p.session, {
    expectedActorId: p.id,
    workspaceId: w,
    expectedRevision: rev,
    connectionId,
    connectionRevision: assistantConnectionRevision(connectionId)!,
    displayName,
    instructions,
  });
const send = (p: Person, w: string, content: string) =>
  execute(p.id, w, randomUUID(), { type: "message.send", content }, p.session);

it("retains one anchored failure for group members, then clears it after a human retry and keeps it clear on a later failed reread", async () => {
  register();
  const author = await person(),
    reader = await person(),
    outsider = await person();
  const w = (await createWorkspace(author.id, "Team", randomUUID())).id;
  await joined(author, reader, w);
  await save(author, w, 0, entry.id, "Iris");
  const request = await send(author, w, "@Iris puoi confrontare le opzioni?");
  const interrupted = {
    async interpret(): Promise<never> {
      throw new DomainError("AI_TIMEOUT", 504);
    },
  };
  const fail = () =>
    expect(
      processInterpretation(request.interpretationId, interrupted),
    ).rejects.toThrow("AI_TIMEOUT");
  await fail();
  await save(author, w, 1, entry.id, "Ada");
  for (const viewer of [author, reader]) {
    const current = await snapshot(viewer.id, w);
    expect(
      assistantRequestFailures(current.messages, current.interpretations).get(
        request.messageId,
      ),
    ).toEqual({
      interpretationId: request.interpretationId,
      displayName: "Iris",
      reason: "unavailable",
      retryable: true,
    });
    expect(
      current.messages.filter(
        (m) => m.reply_to_source_id === request.messageId,
      ),
    ).toHaveLength(0);
  }
  await expect(snapshot(outsider.id, w)).rejects.toThrow(
    "WORKSPACE_ACCESS_DENIED",
  );
  await save(author, w, 2, entry.id, "Iris");
  const retry = () =>
    execute(
      reader.id,
      w,
      randomUUID(),
      {
        type: "interpretation.retry",
        interpretationId: request.interpretationId,
      },
      reader.session,
    );
  await retry();
  const pending = await snapshot(author.id, w);
  expect(
    assistantRequestFailures(pending.messages, pending.interpretations).size,
  ).toBe(0);
  await processInterpretation(request.interpretationId, {
    async interpret(context) {
      return {
        proposals: [],
        needsMore: [],
        response: {
          mode: "respond",
          text: "Ecco il confronto.",
          sourceIds: [context.trigger.id],
        },
      };
    },
  });
  await retry();
  await fail();
  const reread = await snapshot(reader.id, w);
  const rows = reread.messages.filter((m) => m.id === request.messageId);
  expect(assistantRequestFailures(rows, reread.interpretations).size).toBe(0);
  expect(
    reread.messages.filter((m) => m.reply_to_source_id === request.messageId),
  ).toHaveLength(1);
});
async function joined(owner: Person, other: Person, w: string) {
  const invitation = await execute(
    owner.id,
    w,
    randomUUID(),
    {
      type: "invitation.create",
      email: other.email,
      fullHistoryDisclosed: true,
    },
    owner.session,
  );
  await acceptInvitation(other.id, invitation.token, true, other.session);
}
it("keeps creator selections distinct per Workspace and personal account, with transactional creation and stale guards", async () => {
  register();
  const a = await person(),
    b = await person(),
    outsider = await person();
  const w = randomUUID(),
    v = randomUUID(),
    rev = assistantConnectionRevision(entry.id)!;
  const create = () =>
    createWorkspace(
      a.id,
      "Uno",
      w,
      "",
      a.session,
      undefined,
      undefined,
      entry.id,
      rev,
    );
  await create();
  await create();
  await createWorkspace(a.id, "Due", v);
  await joined(a, b, w);
  expect(
    (await view(a)).managedSpaces.map((x) => [x.workspaceId, x.connectionId]),
  ).toEqual([
    [v, "default"],
    [w, entry.id],
  ]);
  expect((await view(b, w)).canManage).toBe(false);
  expect((await view(b, w)).connections.map((x) => x.id)).toEqual([entry.id]);
  await expect(view(outsider, w)).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  await expect(save(b, w, 1, local.id)).rejects.toThrow(
    "ASSISTANT_CREATOR_REQUIRED",
  );
  const changes = await Promise.allSettled([
    save(a, w, 1, local.id),
    save(a, w, 1, "default"),
  ]);
  expect(changes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(changes.filter((x) => x.status === "rejected")[0].reason.message).toBe(
    "ASSISTANT_SETTINGS_STALE",
  );
  expect((await view(a, w)).revision).toBe(2);
  const unchanged = await view(a, v);
  expect(unchanged.connectionId).toBe("default");
  expect(unchanged.instructions).toBe("");
  expect(unchanged.effectiveInstructions).toContain(
    unchanged.defaultInstructions,
  );
  expect(unchanged.effectiveInstructions).not.toContain("Keep answers short.");
  await save(a, undefined, 0, local.id, "Alba");
  expect((await view(b)).displayName).toBe("Emme");
  expect((await view(a)).displayName).toBe("Alba");
  const bad = randomUUID();
  await expect(
    createWorkspace(
      a.id,
      "Invalid",
      bad,
      "",
      a.session,
      undefined,
      undefined,
      entry.id,
      "0".repeat(64),
    ),
  ).rejects.toThrow("ASSISTANT_CONNECTION_CHANGED");
  expect(
    (await pool.query("SELECT id FROM workspace WHERE id=$1", [bad])).rowCount,
  ).toBe(0);
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [a.id]);
  await expect(save(a, w, 2, local.id)).rejects.toThrow("ACCOUNT_INELIGIBLE");
});
it("runs two distinct selected adapters through the real conversational worker path and retains exact reply authorship", async () => {
  register();
  const a = await person();
  const w = (await createWorkspace(a.id, "Team", randomUUID())).id;
  await save(a, w, 0, entry.id);
  const p = (await openPersonalSpace(a.id, a.session)).id;
  await save(a, undefined, 0, local.id, "Alba", "Respond in one sentence.");
  const calls: { endpoint: string; system: string; prompt: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      const req = JSON.parse(init.body as string);
      const prompt: string = req.prompt ?? req.messages[1].content;
      calls.push({
        endpoint: url.href,
        system: req.system ?? req.messages[0].content,
        prompt,
      });
      const id = JSON.parse(prompt).trigger.id;
      const output = {
        proposals: [],
        needsMore: [],
        response: {
          mode: "respond",
          text: "Risposta sintetica",
          sourceIds: [id],
        },
      };
      return Response.json(
        req.protocol
          ? { output }
          : { message: { content: JSON.stringify(output) }, done: true },
      );
    }),
  );
  const group = await send(a, w, "@Emme Fammi un confronto nello spazio.");
  const personal = await send(a, p, "@Emme Richiesta personale separata.");
  await processInterpretation(group.interpretationId);
  await processInterpretation(personal.interpretationId);
  expect(calls.map((x) => x.endpoint)).toEqual([
    entry.url,
    local.baseURL + "/api/chat",
  ]);
  expect(calls[0].prompt).not.toContain("Richiesta personale separata");
  expect(calls[1].prompt).not.toContain("confronto nello spazio");
  expect(calls[0].system).toContain("Keep answers short.");
  expect(calls[0].system).not.toContain("Respond in one sentence.");
  expect(calls[1].system).toContain("Use Alba");
  expect(calls[1].system).toContain("Respond in one sentence.");
  expect(calls[1].system).not.toContain("Keep answers short.");
  await save(a, w, 1, entry.id, "Nome nuovo");
  expect(
    (
      await pool.query(
        "SELECT assistant_display_name FROM message WHERE reply_to_source_id=$1 AND actor_kind='miriam'",
        [group.messageId],
      )
    ).rows[0]?.assistant_display_name,
  ).toBe("Iris");
});
it("blocks a changed destination before dispatch, blocks publication after reselection and permits a human retry", async () => {
  register();
  const a = await person(),
    w = (await createWorkspace(a.id, "Fences", randomUUID())).id;
  await save(a, w, 0, entry.id);
  const m = await send(a, w, "@Emme Verifica un punto.");
  register("https://other.example.test/contribute");
  expect((await view(a, w)).needsReconfirmation).toBe(true);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(processInterpretation(m.interpretationId)).rejects.toThrow(
    "ASSISTANT_CONNECTION_CHANGED",
  );
  expect(fetch).not.toHaveBeenCalled();
  await save(a, w, 1, entry.id);
  await processInterpretation(m.interpretationId);
  expect(fetch).not.toHaveBeenCalled();
  await execute(
    a.id,
    w,
    randomUUID(),
    { type: "interpretation.retry", interpretationId: m.interpretationId },
    a.session,
  );
  fetch.mockImplementation(async () => {
    await save(a, w, 2, local.id);
    return Response.json({
      output: {
        proposals: [],
        needsMore: [],
        response: {
          mode: "respond",
          text: "Late result",
          sourceIds: [m.messageId],
        },
      },
    });
  });
  await processInterpretation(m.interpretationId);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    (
      await pool.query("SELECT status FROM interpretation WHERE id=$1", [
        m.interpretationId,
      ])
    ).rows[0].status,
  ).toBe("stale");
  expect(
    (
      await pool.query(
        "SELECT id FROM message WHERE workspace_id=$1 AND content='Late result'",
        [w],
      )
    ).rowCount,
  ).toBe(0);
});
it("rejects caller-supplied recipients, platform permissions and invalid display names", () => {
  const x = {
    expectedActorId: "a",
    expectedRevision: 0,
    connectionRevision: "0".repeat(64),
    displayName: "Emme",
    instructions: "",
    connectionId: "default",
  };
  expect(
    saveAssistantSettingsSchema.safeParse({
      ...x,
      url: "https://outside.example.test",
    }).success,
  ).toBe(false);
  expect(
    saveAssistantSettingsSchema.safeParse({
      ...x,
      displayName: "X\nNew instruction",
    }).success,
  ).toBe(false);
});

it("attributes an unconfigured named connection before dispatch and redelivers only background failures automatically", async () => {
  register();
  const owner = await person();
  const w = (
    await createWorkspace(owner.id, "Prima della risposta", randomUUID())
  ).id;
  await save(owner, w, 0, entry.id, "Iris");
  const explicit = await send(owner, w, "@Iris cosa manca?");
  const ordinary = await send(owner, w, "Domani va bene");
  vi.stubEnv("RIMIAM_ASSISTANT_CONNECTIONS", "[]");
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  for (const m of [explicit, ordinary]) {
    await expect(processInterpretation(m.interpretationId)).rejects.toThrow(
      "AI_CONFIGURATION_REQUIRED",
    );
  }
  const result = await snapshot(owner.id, w);
  const failures = assistantRequestFailures(
    result.messages,
    result.interpretations,
  );
  expect([...failures.keys()]).toEqual([explicit.messageId]);
  expect(failures.get(explicit.messageId)).toMatchObject({
    reason: "unconfigured",
    displayName: "Iris",
  });
  expect(
    result.interpretations.find((i) => i.id === explicit.interpretationId),
  ).toMatchObject({ explicitRequest: true, otherMemberTarget: null });
  expect(
    (
      await pool.query(
        "SELECT 1 FROM interpretation_input WHERE workspace_id=$1",
        [w],
      )
    ).rowCount,
  ).toBe(0);
  expect(transport).not.toHaveBeenCalled();
  register();
  const interpret = vi.fn(async () => ({
    proposals: [],
    needsMore: [],
    response: { mode: "observe" as const, text: "", sourceIds: [] },
  }));
  await processInterpretation(explicit.interpretationId, { interpret });
  expect(interpret).not.toHaveBeenCalled();
  await processInterpretation(ordinary.interpretationId, { interpret });
  expect(interpret).toHaveBeenCalledTimes(1);
  const restored = await snapshot(owner.id, w);
  expect(
    restored.interpretations.find((i) => i.id === explicit.interpretationId)
      ?.status,
  ).toBe("failed");
  expect(
    restored.interpretations.find((i) => i.id === ordinary.interpretationId)
      ?.status,
  ).toBe("completed");
});
