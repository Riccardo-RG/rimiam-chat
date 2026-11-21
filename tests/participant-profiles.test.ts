import { randomUUID } from "node:crypto";
import { expect, it, afterAll } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import {
  ownProfile,
  workspaceProfile,
} from "../src/server/participant-profiles";
import { openDirect, directPeerProfile } from "../src/server/direct-chat";
import { personalContacts } from "../src/server/personal-contacts";
import { changeOwnProfileSchema } from "../src/contracts/participant-profile";

async function account(name: string) {
  const email = randomUUID() + "@example.test",
    password = "Example-profile-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { name, email, password },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const signed = await auth.api.signInEmail({ body: { email, password } });
  const { rows } = await pool.query("SELECT id FROM session WHERE token=$1", [
    signed.token,
  ]);
  return { id: user.id, email, session: String(rows[0].id) };
}
afterAll(() => pool.end());

it("only the owner can supply a number; concurrent versions do not overwrite each other, and removal persists", async () => {
  const owner = await account("Ada"),
    peer = await account("Piero");
  const update = {
    expectedActorId: owner.id,
    expectedVersion: 0,
    phone: "+39 000 000 0001",
  };
  expect(await ownProfile(owner.id, owner.session)).toMatchObject({
    version: 0,
    phone: null,
  });
  await expect(ownProfile(peer.id, peer.session, update)).rejects.toMatchObject(
    { code: "AUTH_CONTEXT_CHANGED" },
  );
  await expect(
    ownProfile(owner.id, peer.session, update),
  ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  const concurrent = await Promise.allSettled([
    ownProfile(owner.id, owner.session, update),
    ownProfile(owner.id, owner.session, {
      ...update,
      phone: "+39 000 000 0002",
    }),
  ]);
  expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(concurrent.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "PROFILE_VERSION_CHANGED" },
  });
  await ownProfile(owner.id, owner.session, {
    ...update,
    expectedVersion: 1,
    phone: null,
  });
  expect(await ownProfile(owner.id, owner.session)).toMatchObject({
    version: 2,
    phone: null,
  });
  for (const phone of ["x123", "+39;ext=123456", "0043", "0".repeat(16)]) {
    expect(changeOwnProfileSchema.safeParse({ ...update, phone }).success).toBe(
      false,
    );
  }
});

it("reveals contact details only inside an eligible pair or active shared membership and keeps the contact directory name-only", async () => {
  const owner = await account("Ada"),
    peer = await account("Piero"),
    outside = await account("Nora");
  const w = (await createWorkspace(owner.id, "Profilo condiviso", randomUUID()))
    .id;
  const invitation = await execute(
    owner.id,
    w,
    randomUUID(),
    {
      type: "invitation.create",
      email: peer.email,
      fullHistoryDisclosed: true,
    },
    owner.session,
  );
  await acceptInvitation(peer.id, String(invitation.token), true);
  const profile = await ownProfile(owner.id, owner.session, {
    expectedActorId: owner.id,
    expectedVersion: 0,
    phone: "000 000 0001",
  });
  const direct = await openDirect(peer.id, peer.session, owner.id);
  expect(await workspaceProfile(peer.id, peer.session, w, owner.id)).toEqual(
    profile,
  );
  expect(await directPeerProfile(peer.id, peer.session, direct.id)).toEqual(
    profile,
  );
  expect(
    (await personalContacts(peer.id, peer.session, "", 0)).contacts[0],
  ).toEqual({ id: owner.id, name: "Ada", nameAmbiguous: false });
  await expect(
    workspaceProfile(outside.id, outside.session, w, owner.id),
  ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  await expect(
    workspaceProfile(peer.id, peer.session, w, outside.id),
  ).rejects.toMatchObject({ code: "PROFILE_NOT_AVAILABLE" });
  await expect(
    directPeerProfile(outside.id, outside.session, direct.id),
  ).rejects.toMatchObject({ code: "DIRECT_CHAT_NOT_FOUND" });
  await execute(
    peer.id,
    w,
    randomUUID(),
    { type: "member.leave", confirmed: true },
    peer.session,
  );
  await expect(
    workspaceProfile(owner.id, owner.session, w, peer.id),
  ).rejects.toMatchObject({ code: "PROFILE_NOT_AVAILABLE" });
  await expect(
    workspaceProfile(peer.id, peer.session, w, owner.id),
  ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [owner.id]);
  await expect(
    directPeerProfile(peer.id, peer.session, direct.id),
  ).rejects.toMatchObject({ code: "PROFILE_NOT_AVAILABLE" });
});
