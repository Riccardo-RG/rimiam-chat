import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import { handleAPI } from "../src/server/api";
import { createWorkspace, execute } from "../src/server/commands";
import { callConnection } from "../src/server/calls";
import { processCall } from "../src/server/call-worker";
import type { CallTransport } from "../src/server/call-provider";

const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const password = "Session-boundary-regression-2026!";

async function account() {
  const email = `${randomUUID()}@example.test`;
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Session boundary test" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  return { actor: user.id, email, cookie, sessionId: session!.session.id };
}

// Hold the real request body after authentication, without replacing auth or DB.
// The revocation happens before the transaction, exactly where the former
// actor-only adapter could turn a missing reread into an optional session ID.
function delayedRequest(cookie: string, path: string, input: unknown) {
  let opened!: () => void;
  const reading = new Promise<void>((resolve) => (opened = resolve));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        stream = controller;
      },
      pull() {
        opened();
      },
    },
    { highWaterMark: 0 },
  );
  return {
    request: new Request(`${base}/api/v1/${path}`, {
      method: "POST",
      headers: { cookie, origin: base, "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit),
    reading,
    release() {
      stream.enqueue(new TextEncoder().encode(JSON.stringify(input)));
      stream.close();
    },
  };
}

afterAll(() => pool.end());
afterEach(() => vi.unstubAllEnvs());

describe("HTTP mutation session boundary", () => {
  it.each(["command", "creation", "invitation"] as const)(
    "rejects %s when the authenticated session ends during request parsing",
    async (operation) => {
      const person = await account();
      const workspace = (
        await createWorkspace(person.actor, "Session revocation", randomUUID())
      ).id;
      const commandId = randomUUID();
      let invitationId: string | undefined;
      let invitationWorkspace: string | undefined;
      let path = `workspaces/${workspace}/commands`;
      let input: unknown = {
        commandId,
        command: { type: "message.send", content: "Rejected late message" },
      };
      if (operation === "creation") {
        path = "workspaces";
        input = { commandId, name: "Rejected late creation" };
      }
      if (operation === "invitation") {
        const issuer = await account();
        invitationWorkspace = (
          await createWorkspace(issuer.actor, "Invitation source", randomUUID())
        ).id;
        const invitation = await execute(
          issuer.actor,
          invitationWorkspace,
          randomUUID(),
          {
            type: "invitation.create",
            email: person.email,
            fullHistoryDisclosed: true,
          },
          issuer.sessionId,
        );
        invitationId = invitation.invitationId as string;
        path = `invitations/${invitation.token}`;
        input = { fullHistoryAccepted: true };
      }
      const held = delayedRequest(person.cookie, path, input);
      const response = handleAPI(held.request);
      await held.reading;
      await pool.query("DELETE FROM session WHERE id=$1", [person.sessionId]);
      held.release();
      const result = await response;
      expect(result.status).toBe(401);
      expect((await result.json()).error.code).toBe("AUTHENTICATION_REQUIRED");
      expect(
        (
          await pool.query(
            "SELECT 1 FROM command_receipt WHERE command_id=$1",
            [commandId],
          )
        ).rowCount,
      ).toBe(0);
      if (operation === "creation")
        expect(
          (await pool.query("SELECT 1 FROM workspace WHERE id=$1", [commandId]))
            .rowCount,
        ).toBe(0);
      if (invitationId) {
        expect(
          (
            await pool.query("SELECT accepted_at FROM invitation WHERE id=$1", [
              invitationId,
            ])
          ).rows[0].accepted_at,
        ).toBeNull();
        expect(
          (
            await pool.query(
              "SELECT 1 FROM membership WHERE workspace_id=$1 AND user_id=$2",
              [invitationWorkspace, person.actor],
            )
          ).rowCount,
        ).toBe(0);
      }
    },
  );

  it.each(["command", "creation"] as const)(
    "revalidates the captured session after waiting for the %s lock",
    async (operation) => {
      const person = await account();
      const workspace = (
        await createWorkspace(person.actor, "Lock boundary", randomUUID())
      ).id;
      const commandId = randomUUID();
      const blocker = await pool.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await blocker.query("BEGIN");
        const pid = (await blocker.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid;
        if (operation === "creation")
          await blocker.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`${person.actor}:${commandId}`],
          );
        else
          await blocker.query(
            "SELECT id FROM workspace WHERE id=$1 FOR UPDATE",
            [workspace],
          );
        pending = (
          operation === "creation"
            ? createWorkspace(
                person.actor,
                "Blocked creation",
                commandId,
                "",
                person.sessionId,
              )
            : execute(
                person.actor,
                workspace,
                commandId,
                { type: "message.send", content: "Blocked message" },
                person.sessionId,
              )
        ).catch((error: Error) => error);
        await expect
          .poll(
            async () =>
              (
                await pool.query(
                  "SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
                  [pid],
                )
              ).rowCount,
          )
          .toBeGreaterThan(0);
        await pool.query("DELETE FROM session WHERE id=$1", [person.sessionId]);
        await blocker.query("COMMIT");
        expect(await pending).toMatchObject({
          code: "AUTHENTICATION_REQUIRED",
        });
        expect(
          (
            await pool.query(
              "SELECT 1 FROM command_receipt WHERE command_id=$1",
              [commandId],
            )
          ).rowCount,
        ).toBe(0);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pending;
      }
    },
  );

  it("rejects expired and actor-mismatched sessions, including receipt replay", async () => {
    const person = await account();
    const other = await account();
    const workspace = (
      await createWorkspace(person.actor, "Replay boundary", randomUUID())
    ).id;
    const commandId = randomUUID();
    const command = {
      type: "message.send",
      content: "Single committed message",
    };
    const result = await execute(
      person.actor,
      workspace,
      commandId,
      command,
      person.sessionId,
    );
    await expect(
      execute(person.actor, workspace, commandId, command, other.sessionId),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    await pool.query(
      "UPDATE session SET \"expiresAt\"=clock_timestamp()-interval '1 second' WHERE id=$1",
      [person.sessionId],
    );
    await expect(
      execute(person.actor, workspace, commandId, command, person.sessionId),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(
      (
        await pool.query(
          "SELECT result FROM command_receipt WHERE command_id=$1",
          [commandId],
        )
      ).rows.map((row) => row.result),
    ).toEqual([result]);
  });

  it("does not issue a media token for a revoked session", async () => {
    for (const key of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"])
      vi.stubEnv(key, "test-only");
    const person = await account();
    const workspace = (
      await createWorkspace(person.actor, "Call session boundary", randomUUID())
    ).id;
    let connections = 0;
    const transport: CallTransport = {
      async connect() {
        connections++;
        return { url: "wss://test.invalid", token: "test-only-media-token" };
      },
      async participants() {
        return [];
      },
      async remove() {},
      async recordings() {
        return [];
      },
      async start() {
        throw new Error("Unexpected recording");
      },
      async stop() {},
    };
    const joined = await execute(
      person.actor,
      workspace,
      randomUUID(),
      { type: "call.join" },
      person.sessionId,
    );
    const callId = joined.callId as string;
    await processCall(callId, transport);
    await callConnection(
      person.actor,
      workspace,
      callId,
      transport,
      person.sessionId,
    );
    expect(connections).toBe(1);
    await pool.query("DELETE FROM session WHERE id=$1", [person.sessionId]);
    await expect(
      callConnection(
        person.actor,
        workspace,
        callId,
        transport,
        person.sessionId,
      ),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(connections).toBe(1);
  });
});
