import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleAPI } from "../src/server/api";
import { auth } from "../src/server/auth";
import {
  createWorkspace,
  execute,
  acceptInvitation,
  openPersonalSpace,
} from "../src/server/commands";
import { pool } from "../src/server/db";
import {
  claimInterpretation,
  publishInterpretation,
} from "../src/server/interpretation";
import { personalHome, snapshot } from "../src/server/queries";
import { readDocument } from "../src/server/sources";
import { personalContacts } from "../src/server/personal-contacts";
import { referenceDetail } from "../src/server/conversation-reference";
import { processFollowup } from "../src/server/tasks-worker";

const origin = new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000")
  .origin;
async function person(name: string) {
  const email = `${randomUUID()}@example.test`,
    password = "Only-in-personal-space-tests-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const session = (
    await pool.query<{ id: string }>("SELECT id FROM session WHERE token=$1", [
      login.response.token,
    ])
  ).rows[0].id;
  return {
    id: user.id,
    email,
    session,
    cookie: login.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; "),
  };
}
type Person = Awaited<ReturnType<typeof person>>;
function request(
  who: Person,
  data?: unknown,
  requestOrigin = origin,
  path = "personal-space",
) {
  return handleAPI(
    new Request(`${origin}/api/v1/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        origin: requestOrigin,
        cookie: who.cookie,
      },
      ...(data !== undefined && { body: JSON.stringify(data) }),
    }),
  );
}
const cmd = (person: Person, w: string, command: unknown) =>
  execute(person.id, w, randomUUID(), command, person.session);
describe.sequential("lazy account-only utility space", () => {
  let a: Person,
    b: Person,
    personal: string,
    group: string,
    privateSource: string;
  const noteText = `Private material ${randomUUID()}`;
  beforeAll(async () => {
    a = await person("Personal tester A");
    b = await person("Personal tester B");
    group = (await createWorkspace(a.id, "Shared project", randomUUID())).id;
    const invite = await cmd(a, group, {
      type: "invitation.create",
      email: b.email,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(b.id, invite.token as string, true, b.session);
  });
  afterAll(() => pool.end());
  it("cold Home is read-only and concurrent first use creates one identity only for the verified session", async () => {
    expect(await (await request(a)).json()).toEqual({
      id: null,
      reminders: [],
    });
    expect((await request(a, { expectedActorId: b.id })).status).toBe(409);
    await expect(openPersonalSpace(a.id, b.session)).rejects.toThrow(
      "AUTHENTICATION_REQUIRED",
    );
    await expect(personalHome(a.id, b.session)).rejects.toThrow(
      "AUTHENTICATION_REQUIRED",
    );
    expect(
      (await request(a, { expectedActorId: a.id, ownerId: b.id })).status,
    ).toBe(400);
    expect(
      (await request(a, { expectedActorId: a.id }, "https://wrong.example"))
        .status,
    ).toBe(403);
    expect(
      (
        await pool.query("SELECT 1 FROM workspace WHERE personal_owner_id=$1", [
          a.id,
        ])
      ).rowCount,
    ).toBe(0);
    const responses = await Promise.all([
      request(a, { expectedActorId: a.id }),
      request(a, { expectedActorId: a.id }),
    ]);
    expect(responses.every((r) => r.ok)).toBe(true);
    const spaces = await Promise.all(responses.map((r) => r.json()));
    expect(spaces[0]).toEqual(spaces[1]);
    personal = spaces[0].id;
    expect(await (await request(b)).json()).toEqual({
      id: null,
      reminders: [],
    });
    expect(
      await (await request(a, undefined, origin, "workspaces")).json(),
    ).toEqual({
      workspaces: [
        expect.objectContaining({ id: group, name: "Shared project" }),
      ],
    });
    expect((await snapshot(a.id, personal)).workspace.personal).toBe(true);
    expect((await snapshot(b.id, group)).workspace.personal).toBe(false);
  });
  it("enforces private membership, rules out links from either endpoint and returns the same denial as an unknown ID", async () => {
    const link = (otherWorkspaceId: string) => ({
      type: "workspace.link",
      otherWorkspaceId,
      expectedVersion: 0,
      linked: true,
    });
    for (const command of [
      { type: "invitation.create", email: b.email, fullHistoryDisclosed: true },
      link(group),
      { type: "goal.establish", content: "Group decision" },
      { type: "member.leave", confirmed: true },
    ]) {
      await expect(cmd(a, personal, command)).rejects.toThrow(
        "PERSONAL_SPACE_UNSUPPORTED",
      );
    }
    for (const [path, data] of [
      [
        "email-compose",
        { draftId: randomUUID(), version: 1, instruction: "Send" },
      ],
      ["call-connect", { callId: randomUUID() }],
    ] as const) {
      const res = await request(
        a,
        data,
        origin,
        `workspaces/${personal}/${path}`,
      );
      expect((await res.json()).error.code).toBe("PERSONAL_SPACE_UNSUPPORTED");
    }
    await expect(cmd(a, group, link(personal))).rejects.toThrow(
      "PERSONAL_SPACE_UNSUPPORTED",
    );
    await expect(cmd(b, group, link(personal))).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await expect(
      pool.query("INSERT INTO membership(workspace_id,user_id) VALUES($1,$2)", [
        personal,
        b.id,
      ]),
    ).rejects.toThrow("Personal membership");
    await expect(
      pool.query("UPDATE workspace SET personal_owner_id=NULL WHERE id=$1", [
        personal,
      ]),
    ).rejects.toThrow("cannot be converted");
    for (const w of [personal, randomUUID()]) {
      const response = await request(
        b,
        undefined,
        origin,
        `workspaces/${w}/workspace`,
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe(
        "WORKSPACE_ACCESS_DENIED",
      );
    }
    expect(
      (
        await pool.query(
          "SELECT 1 FROM access_relationship WHERE workspace_id=$1",
          [personal],
        )
      ).rowCount,
    ).toBe(0);
    const contacts = await personalContacts(b.id, b.session, "", 0);
    expect(JSON.stringify(contacts)).not.toContain(personal);
  });
  it("keeps links and uploads local and limits explicitly addressed chat to private sources and reply-only inference", async () => {
    const message = await cmd(a, personal, {
      type: "message.send",
      content: `https://example.test/ ${noteText}`,
    });
    expect(message.interpretationId).toBeUndefined();
    const file = await cmd(a, personal, {
      type: "document.upload",
      filename: "private.txt",
      bytesBase64: Buffer.from(noteText).toString("base64"),
    });
    privateSource = file.sourceId as string;
    expect(file.interpretationId).toBeUndefined();
    expect(
      (
        await readDocument(a.id, personal, privateSource)
      ).original_bytes.toString(),
    ).toBe(noteText);
    await expect(readDocument(b.id, personal, privateSource)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await expect(readDocument(b.id, group, privateSource)).rejects.toThrow(
      "SOURCE_NOT_FOUND",
    );
    const note = {
      type: "artifact.compose",
      title: "Private note",
      purpose: "Reference",
      blocks: [{ type: "paragraph", text: noteText }],
      sourceIds: [privateSource],
      reason: "Explicit save",
      nonOperative: true,
    };
    const saved = await cmd(a, personal, note);
    await cmd(a, personal, {
      ...note,
      title: "Updated private note",
      artifactId: saved.artifactId,
      expectedVersion: 1,
    });
    await expect(
      cmd(a, personal, {
        type: "artifact.review",
        artifactId: saved.artifactId,
        version: 2,
        people: [b.id],
        nonOperative: true,
      }),
    ).rejects.toThrow("PERSONAL_SPACE_UNSUPPORTED");
    const otherText = `Other space ${randomUUID()}`;
    const shared = await cmd(b, group, {
      type: "message.send",
      content: otherText,
    });
    const otherClaim = await claimInterpretation(
      shared.interpretationId as string,
    );
    expect(JSON.stringify(otherClaim?.context)).not.toContain(noteText);
    const addressed = await cmd(a, personal, {
      type: "message.send",
      content: "@Emme, prepara un’analisi delle mie note",
    });
    expect(addressed.workId).toBeUndefined();
    const claim = await claimInterpretation(
      addressed.interpretationId as string,
    );
    expect(claim?.personal).toBe(true);
    expect(claim!.context.productCapabilities.actions.map((x) => x.id)).toEqual(
      ["conversation", "artifacts", "sources.upload", "followup"],
    );
    expect(JSON.stringify(claim!.context)).not.toContain(otherText);
    await publishInterpretation(claim!, {
      needsMore: [],
      proposals: [
        {
          subject: "Unconfirmed",
          content: "Unconfirmed",
          classification: "descriptive",
          origin: "inferred",
          qualification: "Hypothesis",
          sourceIds: [claim!.context.trigger.id],
        },
      ],
      workIntent: { objective: "Start another analysis" },
      response: {
        mode: "respond",
        text: "Risposta privata.",
        sourceIds: [claim!.context.trigger.id],
      },
    });
    const personalState = await snapshot(a.id, personal);
    expect(personalState.candidates).toEqual([]);
    expect(personalState.handoffs).toEqual([]);
    expect(
      personalState.messages.some((m) => m.content === "Risposta privata."),
    ).toBe(true);
    expect(
      (
        await pool.query("SELECT 1 FROM active_work WHERE workspace_id=$1", [
          personal,
        ])
      ).rowCount,
    ).toBe(0);
    expect(JSON.stringify(await snapshot(b.id, group))).not.toContain(noteText);
  });
  it("returns at most the next three active personal reminders in chronological order, with scoped reference checks", async () => {
    const reminder = (content: string, remindAt: string) => ({
      type: "followup.create",
      content,
      kind: "remember",
      timeZone: "UTC",
      reference: null,
      remindAt,
    });
    for (const day of [5, 2, 4, 1])
      await cmd(
        a,
        personal,
        reminder(`Memo ${day}`, `2040-11-0${day}T08:00:00.000Z`),
      );
    await cmd(a, group, reminder("Shared only", "2040-01-01T09:00:00.000Z"));
    const due = await cmd(
      a,
      personal,
      reminder("Solo personale", new Date(0).toISOString()),
    );
    expect(await processFollowup(personal, due.followupId as string, 1)).toBe(
      "delivered",
    );
    const published = (await snapshot(a.id, personal)).messages.find(
      (m) => m.content === "Promemoria: Solo personale",
    );
    expect(published).toBeDefined();
    const detail = await referenceDetail(a.id, personal, {
      kind: "source",
      id: published!.id,
      version: 1,
    });
    expect(detail.qualification).toContain("pubblicato automaticamente");
    expect(detail.provenance).toMatchObject({
      followupId: due.followupId,
      followupVersion: 1,
    });
    expect(JSON.stringify(await snapshot(b.id, group))).not.toContain(
      "Solo personale",
    );
    const home = await (await request(a)).json();
    expect(home.reminders.map((v: { content: string }) => v.content)).toEqual([
      "Memo 1",
      "Memo 2",
      "Memo 4",
    ]);
    expect((await (await request(b)).json()).reminders).toEqual([]);
    await expect(
      cmd(a, group, {
        ...reminder("Invalid reference", "2040-01-01T09:00:00.000Z"),
        reference: { kind: "source", id: privateSource, version: 1 },
      }),
    ).rejects.toThrow("WORK_REFERENCE_NOT_FOUND");
  });
});
