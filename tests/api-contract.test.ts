import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import { handleAPI } from "../src/server/api";
import { createWorkspace, execute } from "../src/server/commands";
import { betaFeedbackViewSchema } from "../src/contracts/beta-feedback";
import { aiUsageViewSchema } from "../src/contracts/ai-usage";
import {
  stateSchema,
  messagesSchema,
  changesSchema,
  receiptSchema,
  errorSchema,
  loginResultSchema,
  historySchema,
} from "../src/contracts/v1";

const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const password = "Native-contract-test-2026!";
let token: string,
  cookie: string,
  userId: string,
  workspaceId: string,
  foreign: string;
const json = { "Content-Type": "application/json" };
const call = (
  path: string,
  data?: unknown,
  extra: Record<string, string> = {},
  method?: string,
) =>
  handleAPI(
    new Request(`${base}/api/v1/${path}`, {
      method: method ?? (data === undefined ? "GET" : "POST"),
      headers: { ...json, Authorization: `Bearer ${token}`, ...extra },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
  );
beforeAll(async () => {
  const email = `${randomUUID()}@example.test`;
  const signup = await auth.api.signUpEmail({
    body: { email, password, name: "Native contract person" },
  });
  userId = signup.user.id;
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    userId,
  ]);
  const login = await handleAPI(
    new Request(`${base}/api/v1/native/session`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(login.status).toBe(200);
  expect(login.headers.has("set-cookie")).toBe(false);
  token = loginResultSchema.parse(await login.json()).token;
  const web = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  cookie = web.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  expect(web.headers.has("set-auth-token")).toBe(false);
  workspaceId = (
    await createWorkspace(userId, "Native contract workspace", randomUUID())
  ).id;
  const other = await auth.api.signUpEmail({
    body: {
      email: `${randomUUID()}@example.test`,
      password,
      name: "Other person",
    },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    other.user.id,
  ]);
  foreign = (
    await createWorkspace(
      other.user.id,
      "Private other workspace",
      randomUUID(),
    )
  ).id;
});
afterAll(() => pool.end());
describe.sequential(
  "Public v1 API with real PostgreSQL and authentication",
  () => {
    it("shares beta feedback through authenticated contracts while usage stays an on-demand guarded read", async () => {
      const saved = await call(`workspaces/${workspaceId}/commands`, {
        commandId: randomUUID(),
        command: { type: "beta.feedback.add", content: "Contract feedback" },
      });
      expect(saved.status).toBe(200);
      const response = await call(`workspaces/${workspaceId}/beta-feedback`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const view = betaFeedbackViewSchema.parse(await response.json());
      expect(
        view.entries.some(
          (entry) =>
            entry.content === "Contract feedback" && entry.authorId === userId,
        ),
      ).toBe(true);
      const web = await handleAPI(
        new Request(`${base}/api/v1/workspaces/${workspaceId}/beta-feedback`, {
          headers: { cookie },
        }),
      );
      expect(web.status).toBe(200);
      expect(betaFeedbackViewSchema.parse(await web.json()).entries).toEqual(
        view.entries,
      );
      const usage = await call(`workspaces/${workspaceId}/ai-usage?days=7`);
      expect(usage.status).toBe(200);
      expect(aiUsageViewSchema.parse(await usage.json()).periodDays).toBe(7);
      expect(
        (await call(`workspaces/${workspaceId}/ai-usage?days=10000`)).status,
      ).toBe(400);
      for (const path of ["beta-feedback", "ai-usage"]) {
        expect((await call(`workspaces/${foreign}/${path}`)).status).toBe(403);
        expect(
          (
            await handleAPI(
              new Request(`${base}/api/v1/workspaces/${workspaceId}/${path}`),
            )
          ).status,
        ).toBe(401);
      }
    });
    it("publishes a language-neutral contract without loading client framework types", async () => {
      const response = await handleAPI(
        new Request(`${base}/api/v1/openapi.json`),
      );
      const schema = await response.json();
      expect(schema.openapi).toBe("3.1.0");
      expect(schema.components.schemas.CommandRequest).toBeDefined();
      expect(schema.paths["/workspaces/{workspaceId}/history"]).toBeDefined();
    });
    it("records Workspace creation receipts and replays creation without granting new authority", async () => {
      const commandId = randomUUID();
      const created = await call("workspaces", {
        commandId,
        expectedActorId: userId,
        name: "Created through v1",
        description: "Descrizione introduttiva, non Goal",
      });
      expect(created.status).toBe(200);
      expect(await created.json()).toEqual({ id: commandId });
      const receipt = await call(
        `workspaces/${commandId}/receipts/${commandId}`,
      );
      expect(receipt.status).toBe(200);
      expect((await receipt.json()).result).toEqual({ id: commandId });
      const replay = await call("workspaces", {
        commandId,
        expectedActorId: userId,
        name: "Created through v1",
        description: "Descrizione introduttiva, non Goal",
      });
      expect(replay.status).toBe(200);
      expect(
        (
          await call("workspaces", {
            commandId,
            name: "Created through v1",
            description: "Diversa",
          })
        ).status,
      ).toBe(409);
      const initialized = stateSchema.parse(
        await (await call(`workspaces/${commandId}/state`)).json(),
      );
      expect(initialized.goals).toHaveLength(0);
      const initialMessages = messagesSchema.parse(
        await (
          await call(
            `workspaces/${commandId}/messages?after=0&through=${initialized.messageSequence}`,
          )
        ).json(),
      ).messages;
      expect(initialMessages.map((m) => m.purpose)).toEqual([
        "workspace_introduction",
        "workspace_welcome",
      ]);
      expect(initialMessages[0].authorId).toBe(userId);

      expect(
        (await call("workspaces", { commandId, name: "Changed" })).status,
      ).toBe(409);
    });
    it("keeps native signed sessions separate from cookies, origins and browser fetch", async () => {
      expect((await call("native/session")).status).toBe(200);
      for (const extra of [
        { Cookie: cookie },
        { Origin: base },
        { "Sec-Fetch-Site": "same-origin" },
        { Authorization: "Bearer forged" },
      ] as Record<string, string>[]) {
        const r = await call("native/session", undefined, extra);
        expect([401, 403]).toContain(r.status);
        errorSchema.parse(await r.json());
      }
      const raw = (
        await pool.query(
          'SELECT token FROM session WHERE "userId"=$1 ORDER BY "createdAt" LIMIT 1',
          [userId],
        )
      ).rows[0].token;
      expect(
        (
          await call("native/session", undefined, {
            Authorization: `Bearer ${raw}`,
          })
        ).status,
      ).toBe(401);
      const crossSite = new Request(
        `${base}/api/v1/workspaces/${workspaceId}/commands`,
        {
          method: "POST",
          headers: {
            ...json,
            Cookie: cookie,
            Origin: "https://untrusted.example",
          },
          body: JSON.stringify({
            commandId: randomUUID(),
            command: { type: "message.send", content: "must not happen" },
          }),
        },
      );
      expect((await handleAPI(crossSite)).status).toBe(403);
      const nativeLoginWithCookie = new Request(
        `${base}/api/v1/native/session`,
        { method: "POST", headers: { ...json, Cookie: cookie }, body: "{}" },
      );
      expect((await handleAPI(nativeLoginWithCookie)).status).toBe(403);
    });
    it("commits once, recovers a discarded response and rejects key reuse with changed content", async () => {
      const commandId = randomUUID(),
        command = {
          type: "message.send",
          content: "Response deliberately discarded",
        };
      const response = await call(`workspaces/${workspaceId}/commands`, {
        commandId,
        command,
      });
      expect(response.status).toBe(200); // simulate transport loss: do not consume the result
      const recovered = receiptSchema.parse(
        await (
          await call(`workspaces/${workspaceId}/receipts/${commandId}`)
        ).json(),
      );
      expect(recovered.status).toBe("committed");
      const replay = receiptSchema.parse(
        await (
          await call(`workspaces/${workspaceId}/commands`, {
            commandId,
            command,
          })
        ).json(),
      );
      expect(replay).toEqual(recovered);
      const conflict = await call(`workspaces/${workspaceId}/commands`, {
        commandId,
        command: { ...command, content: "Changed" },
      });
      expect(conflict.status).toBe(409);
      expect((await conflict.json()).error.code).toBe("COMMAND_ID_REUSED");
      expect(
        (
          await pool.query(
            "SELECT id FROM message WHERE workspace_id=$1 AND content=$2",
            [workspaceId, command.content],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (await call(`workspaces/${workspaceId}/receipts/${randomUUID()}`))
          .status,
      ).toBe(404);
    });
    it("supports the same commands with protected web cookies", async () => {
      const response = await handleAPI(
        new Request(`${base}/api/v1/workspaces/${workspaceId}/commands`, {
          method: "POST",
          headers: { ...json, Cookie: cookie, Origin: base },
          body: JSON.stringify({
            commandId: randomUUID(),
            command: {
              type: "message.send",
              content: "From web cookie transport",
            },
          }),
        }),
      );
      expect(response.status).toBe(200);
      receiptSchema.parse(await response.json());
    });
    it("pages history against a stable message boundary while new messages arrive", async () => {
      const state = stateSchema.parse(
        await (await call(`workspaces/${workspaceId}/state`)).json(),
      );
      expect(state.messageSequence).toBe(3);
      const first = messagesSchema.parse(
        await (
          await call(
            `workspaces/${workspaceId}/messages?after=1&through=${state.messageSequence}&limit=1`,
          )
        ).json(),
      );
      expect(first.hasMore).toBe(true);
      await execute(userId, workspaceId, randomUUID(), {
        type: "message.send",
        content: "New while paging",
      });
      const second = messagesSchema.parse(
        await (
          await call(
            `workspaces/${workspaceId}/messages?after=${first.nextAfter}&through=${first.through}&limit=1`,
          )
        ).json(),
      );
      expect(second.hasMore).toBe(false);
      expect(second.nextAfter).toBe(state.messageSequence);
      expect(second.messages[0].id).not.toBe(first.messages[0].id);
      const nextState = stateSchema.parse(
        await (await call(`workspaces/${workspaceId}/state`)).json(),
      );
      const tail = messagesSchema.parse(
        await (
          await call(
            `workspaces/${workspaceId}/messages?after=${second.nextAfter}&through=${nextState.messageSequence}`,
          )
        ).json(),
      );
      expect(tail.messages.map((x) => x.content)).toEqual(["New while paging"]);
      const batch = changesSchema.parse(
        await (
          await call(
            `workspaces/${workspaceId}/changes?after=${state.workspace.revision}&limit=1`,
          )
        ).json(),
      );
      expect(batch.nextAfter).toBe(nextState.workspace.revision);
      expect(batch.changes).toHaveLength(1);
      const latest = historySchema.parse(
        await (
          await call(
            `workspaces/${workspaceId}/history?through=${nextState.messageSequence}&limit=1`,
          )
        ).json(),
      );
      expect(latest.messages[0].content).toBe("New while paging");
      expect(latest.hasMore).toBe(true);
      const older = historySchema.parse(
        await (
          await call(
            `workspaces/${workspaceId}/history?before=${latest.nextBefore}&through=${nextState.messageSequence}&limit=1`,
          )
        ).json(),
      );
      expect(older.messages[0].sequence).toBe(latest.nextBefore - 1);

      expect(
        (await call(`workspaces/${workspaceId}/changes?after=999999`)).status,
      ).toBe(409);
    });
    it("round-trips exact Workstream focus through the authenticated command and paginated read boundary", async () => {
      const w = (await createWorkspace(userId, "Focused API", randomUUID())).id;
      const stream = await execute(userId, w, randomUUID(), {
        type: "workstream.save",
        title: "RIMIAM beta",
        description: "Interviste",
      });
      const focus = { workstreamId: stream.id, version: 1 };
      const response = await call(`workspaces/${w}/commands`, {
        commandId: randomUUID(),
        command: {
          type: "message.send",
          content: "Domande per la beta",
          workstreamFocus: focus,
        },
      });
      expect(response.status).toBe(200);
      const sent = receiptSchema.parse(await response.json()).result;
      const head = stateSchema.parse(
        await (await call(`workspaces/${w}/state`)).json(),
      ).messageSequence;
      for (const resource of ["messages", "history"]) {
        const page = await call(
          `workspaces/${w}/${resource}?through=${head}&workstreamId=${stream.id}`,
        );
        expect(page.status).toBe(200);
        expect((await page.json()).messages).toEqual([
          expect.objectContaining({
            id: sent.messageId,
            workstreamFocus: focus,
          }),
        ]);
        expect(
          (
            await call(
              `workspaces/${w}/${resource}?through=${head}&workstreamId=invalid`,
            )
          ).status,
        ).toBe(400);
        expect(
          (
            await call(
              `workspaces/${w}/${resource}?through=${head}&workstreamId=${randomUUID()}`,
            )
          ).status,
        ).toBe(404);
      }
    });
    it("denies cross-Workspace state, sources of updates and command receipts", async () => {
      for (const path of [
        "state",
        "messages?through=10",
        "changes",
        `receipts/${randomUUID()}`,
        "events",
      ])
        expect((await call(`workspaces/${foreign}/${path}`)).status).toBe(403);
      expect(
        (
          await call(`workspaces/${foreign}/commands`, {
            commandId: randomUUID(),
            command: { type: "message.send", content: "forbidden" },
          })
        ).status,
      ).toBe(403);
    });
    it("replays SSE from Last-Event-ID and terminates on revocation", async () => {
      const head = stateSchema.parse(
        await (await call(`workspaces/${workspaceId}/state`)).json(),
      ).workspace.revision;
      const response = await call(
        `workspaces/${workspaceId}/events`,
        undefined,
        { "Last-Event-ID": String(head - 1) },
      );
      const reader = response.body!.getReader();
      const event = new TextDecoder().decode((await reader.read()).value);
      expect(event).toContain(`id: ${head}`);
      await pool.query(
        "UPDATE membership SET active=false WHERE workspace_id=$1 AND user_id=$2",
        [workspaceId, userId],
      );
      expect((await reader.read()).done).toBe(true);
      expect((await call(`workspaces/${workspaceId}/state`)).status).toBe(403);
      await pool.query(
        "UPDATE membership SET active=true WHERE workspace_id=$1 AND user_id=$2",
        [workspaceId, userId],
      );
    });
    it("logout revokes the native session without revoking an independent web session", async () => {
      expect(
        (await call("native/session", undefined, {}, "DELETE")).status,
      ).toBe(200);
      expect((await call("native/session")).status).toBe(401);
      const web = await handleAPI(
        new Request(`${base}/api/v1/workspaces`, {
          headers: { Cookie: cookie },
        }),
      );
      expect(web.status).toBe(200);
    });
  },
);
