import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { workspaceInvitationsSchema } from "../src/contracts/workspace-invitations";
import { commandSchema } from "../src/contracts/commands";
import { decryptAccountLink } from "../src/server/account-delivery";
import {
  acceptInvitation,
  createWorkspace,
  execute,
} from "../src/server/commands";
import { pool } from "../src/server/db";
import { processInvitationMail } from "../src/server/invitation-delivery";
import {
  incomingInvitations,
  invitationDetails,
  snapshot,
} from "../src/server/queries";

afterAll(() => pool.end());

async function person() {
  const id = randomUUID();
  const email = `${id}@example.test`;
  const session = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$2,$3,true,now(),now(),true)',
    [id, "Luca", email],
  );
  await pool.query(
    'INSERT INTO session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now(),now())',
    [session, randomUUID(), id],
  );
  return { id, email, session };
}

async function knownPeople() {
  const a = await person();
  const b = await person();
  const w = (await createWorkspace(a.id, "Previously shared", randomUUID())).id;
  const invite = await execute(a.id, w, randomUUID(), {
    type: "invitation.create",
    fullHistoryDisclosed: true,
    email: b.email,
  });
  await acceptInvitation(b.id, invite.token, true);
  return { a, b };
}

it("creates one recipient-bound invitation and queued delivery per person, even across concurrent retries and duplicate selections", async () => {
  const { a, b } = await knownPeople();
  const w = randomUUID();
  const email = `${randomUUID()}@example.test`;
  const recipients = [
    { email: b.email.toUpperCase() },
    { contactId: b.id },
    { email },
  ];
  const create = (items: typeof recipients) =>
    createWorkspace(a.id, "New workspace", w, "", a.session, {
      fullHistoryDisclosed: true,
      recipients: items,
    });
  expect(
    await Promise.all([create(recipients), create([...recipients].reverse())]),
  ).toEqual([{ id: w }, { id: w }]);
  const { rows } = await pool.query(
    "SELECT i.id,i.recipient_email,i.recipient_contact_id,i.history_disclosed,d.status FROM invitation i JOIN invitation_delivery d ON d.invitation_id=i.id WHERE i.workspace_id=$1",
    [w],
  );
  expect(rows).toHaveLength(2);
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        recipient_contact_id: b.id,
        recipient_email: b.email,
        history_disclosed: true,
        status: "queued",
      }),
      expect.objectContaining({
        recipient_contact_id: null,
        recipient_email: email,
        history_disclosed: true,
        status: "queued",
      }),
    ]),
  );
  expect((await snapshot(a.id, w)).invitations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ recipient_name: "Luca", recipient_email: "" }),
    ]),
  );
  expect(
    (
      await pool.query(
        "SELECT result FROM command_receipt WHERE workspace_id=$1",
        [w],
      )
    ).rows,
  ).toEqual([{ result: { id: w } }]);
  await expect(create([{ email }])).rejects.toThrow("COMMAND_ID_REUSED");
  await expect(snapshot(b.id, w)).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  const inbox = (await incomingInvitations(b.id, b.session)).invitations;
  expect(inbox).toHaveLength(1);
  const selection = { recipientInvitationId: inbox[0].id };
  await expect(
    acceptInvitation(b.id, selection, false, b.session),
  ).rejects.toThrow();
  await acceptInvitation(b.id, selection, true, b.session);
  expect(
    (
      await pool.query(
        "SELECT contributes FROM membership WHERE workspace_id=$1 AND user_id=$2 AND active",
        [w, b.id],
      )
    ).rows,
  ).toEqual([{ contributes: true }]);
  expect(
    (
      await pool.query(
        "SELECT id FROM access_relationship WHERE workspace_id=$1 AND holder_id=$2",
        [w, b.id],
      )
    ).rowCount,
  ).toBe(0);
});

it("rolls back workspace and all invitations for foreign/self selection or a lost session; requires explicit disclosure", async () => {
  const a = await person();
  const stranger = await person();
  const w = randomUUID();
  for (const [recipient, error] of [
    [{ contactId: stranger.id }, "PERSONAL_CONTACT_UNAVAILABLE"],
    [{ email: a.email.toUpperCase() }, "CANNOT_INVITE_SELF"],
  ] as const) {
    await expect(
      createWorkspace(a.id, "Mixed", w, "", a.session, {
        fullHistoryDisclosed: true,
        recipients: [{ email: "new@example.test" }, recipient],
      }),
    ).rejects.toThrow(error);
  }
  const batch = {
    fullHistoryDisclosed: true as const,
    recipients: [{ email: stranger.email }],
  };
  expect(
    workspaceInvitationsSchema.safeParse({
      ...batch,
      fullHistoryDisclosed: false,
    }).success,
  ).toBe(false);
  await expect(
    createWorkspace(a.id, "Mixed", w, "", randomUUID(), batch),
  ).rejects.toThrow("AUTHENTICATION_REQUIRED");
  expect(
    (await pool.query("SELECT 1 FROM workspace WHERE id=$1", [w])).rowCount,
  ).toBe(0);
  expect(
    (await pool.query("SELECT 1 FROM invitation WHERE workspace_id=$1", [w]))
      .rowCount,
  ).toBe(0);
});

it("fences delivery and admission of contact invitations when another account takes the original address", async () => {
  const { a, b } = await knownPeople();
  const c = await person();
  const w = (
    await createWorkspace(
      a.id,
      "Identity binding",
      randomUUID(),
      "",
      a.session,
      {
        fullHistoryDisclosed: true,
        recipients: [{ contactId: b.id }],
      },
    )
  ).id;
  const [invite] = (await incomingInvitations(b.id, b.session)).invitations;
  const delivery = (
    await pool.query(
      "SELECT encrypted_link FROM invitation_delivery WHERE invitation_id=$1",
      [invite.id],
    )
  ).rows[0];
  const url = new URL(
    decryptAccountLink(
      delivery.encrypted_link,
      JSON.stringify(["invitation", invite.id, "link"]),
    ),
  );
  const token = url.searchParams.get("invite")!;
  expect(await invitationDetails(b.id, token)).toMatchObject({
    recipient_email: b.email,
  });
  await pool.query('UPDATE "user" SET email=$2 WHERE id=$1', [
    b.id,
    `new-${b.email}`,
  ]);
  await pool.query('UPDATE "user" SET email=$2 WHERE id=$1', [c.id, b.email]);
  expect((await incomingInvitations(c.id, c.session)).invitations).toEqual([]);
  await expect(invitationDetails(c.id, token)).rejects.toThrow(
    "INVITATION_INVALID",
  );
  await expect(acceptInvitation(c.id, token, true, c.session)).rejects.toThrow(
    "INVITATION_RECIPIENT_MISMATCH",
  );
  await expect(
    acceptInvitation(
      c.id,
      { recipientInvitationId: invite.id },
      true,
      c.session,
    ),
  ).rejects.toThrow("INVITATION_INVALID");
  const transport = { prepare: vi.fn(), send: vi.fn() };
  await processInvitationMail(invite.id, transport);
  expect(transport.prepare).not.toHaveBeenCalled();
  expect(transport.send).not.toHaveBeenCalled();
  expect(
    (
      await pool.query(
        "SELECT status FROM invitation_delivery WHERE invitation_id=$1",
        [invite.id],
      )
    ).rows,
  ).toEqual([{ status: "cancelled" }]);
  await expect(snapshot(c.id, w)).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
});

it("invites a known contact to an existing space without exposing the contact email or admitting strangers", async () => {
  const { a, b } = await knownPeople();
  const stranger = await person();
  const w = (await createWorkspace(a.id, "New collaborators", randomUUID())).id;
  const invitation = {
    type: "invitation.create" as const,
    contactId: b.id,
    sendEmail: true,
    fullHistoryDisclosed: true as const,
  };
  expect(
    commandSchema.safeParse({ ...invitation, email: b.email }).success,
  ).toBe(false);
  expect(
    commandSchema.safeParse({ ...invitation, contactId: undefined }).success,
  ).toBe(false);
  await expect(
    execute(a.id, w, randomUUID(), { ...invitation, contactId: stranger.id }),
  ).rejects.toThrow("PERSONAL_CONTACT_UNAVAILABLE");
  expect((await snapshot(a.id, w)).invitations).toHaveLength(0);
  const commandId = randomUUID();
  const result = await execute(a.id, w, commandId, invitation);
  const repeated = await execute(a.id, w, commandId, invitation);
  expect(result.invitationId).toBe(repeated.invitationId);
  const visible = (await snapshot(a.id, w)).invitations;
  expect(visible).toHaveLength(1);
  expect(visible[0]).toMatchObject({
    recipient_email: "",
    recipient_name: "Luca",
  });
  expect(JSON.stringify(result)).not.toContain(b.email);
  expect(
    (
      await pool.query(
        "SELECT recipient_contact_id, history_disclosed FROM invitation WHERE id=$1",
        [result.invitationId],
      )
    ).rows[0],
  ).toEqual({ recipient_contact_id: b.id, history_disclosed: true });
  await expect(
    acceptInvitation(stranger.id, result.token, true),
  ).rejects.toThrow();
  await acceptInvitation(b.id, result.token, true);
  await expect(execute(b.id, w, randomUUID(), invitation)).rejects.toThrow(
    "ACCESS_AUTHORITY_REQUIRED",
  );
});
