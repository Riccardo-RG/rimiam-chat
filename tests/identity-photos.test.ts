import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import {
  identityPhotoDirectory,
  normalizeIdentityImage,
  changeIdentityPhoto,
  readIdentityPhoto,
} from "../src/server/identity-photos";

async function account() {
  const email = randomUUID() + "@example.test",
    password = "Test-profile-image-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Photo test" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } });
  const result = await pool.query("SELECT id FROM session WHERE token=$1", [
    login.token,
  ]);
  return { id: user.id, email, session: String(result.rows[0].id) };
}
afterAll(() => pool.end());
it("re-encodes immutable input to a square JPEG without retaining metadata or accepting markup", async () => {
  const raw = await sharp({
    create: { width: 50, height: 80, channels: 3, background: "red" },
  })
    .jpeg()
    .withMetadata({ density: 300 })
    .toBuffer();
  const image = await normalizeIdentityImage(raw.toString("base64"));
  const meta = await sharp(image).metadata();
  expect(meta.width).toBe(256);
  expect(meta.height).toBe(256);
  expect(meta.exif).toBeUndefined();
  await expect(
    normalizeIdentityImage(Buffer.from("<svg/>").toString("base64")),
  ).rejects.toMatchObject({ code: "INVALID_PHOTO" });
  await expect(
    normalizeIdentityImage(
      Buffer.from([255, 216, 255, 1, 0, 3, 9]).toString("base64"),
    ),
  ).rejects.toMatchObject({ code: "INVALID_PHOTO" });
});
it("authorizes photos for their owner and eligible co-members and requires contribution/version for Workspace changes", async () => {
  const a = await account(),
    b = await account(),
    outside = await account();
  const w = (await createWorkspace(a.id, "Photo scope", randomUUID())).id;
  const input = await sharp({
    create: { width: 20, height: 25, channels: 3, background: "teal" },
  })
    .jpeg()
    .toBuffer();
  const image = input.toString("base64");
  const v1 = { expectedActorId: a.id, expectedVersion: 0, image };
  await changeIdentityPhoto(a.id, a.session, v1);
  await expect(
    readIdentityPhoto(outside.id, outside.session, undefined, a.id),
  ).rejects.toMatchObject({ code: "PHOTO_NOT_FOUND" });
  const invitation = await execute(
    a.id,
    w,
    randomUUID(),
    { type: "invitation.create", email: b.email, fullHistoryDisclosed: true },
    a.session,
  );
  await acceptInvitation(b.id, String(invitation.token), true);
  const dir = await identityPhotoDirectory(b.id, b.session, w);
  expect(dir.members[a.id]?.present).toBe(true);
  expect(await readIdentityPhoto(b.id, b.session, w, a.id)).toBeInstanceOf(
    Buffer,
  );
  await expect(
    changeIdentityPhoto(outside.id, outside.session, {
      ...v1,
      expectedActorId: outside.id,
      workspace: w,
    }),
  ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  await changeIdentityPhoto(b.id, b.session, {
    expectedActorId: b.id,
    expectedVersion: 0,
    image,
    workspace: w,
  });
  expect((await identityPhotoDirectory(a.id, a.session)).rooms[w].version).toBe(
    1,
  );
  await expect(
    changeIdentityPhoto(a.id, a.session, { ...v1, image: null, workspace: w }),
  ).rejects.toMatchObject({ code: "PHOTO_VERSION_CHANGED" });
  await pool.query(
    "UPDATE membership SET contributes=false WHERE workspace_id=$1 AND user_id=$2",
    [w, b.id],
  );
  await expect(
    changeIdentityPhoto(b.id, b.session, {
      expectedActorId: b.id,
      expectedVersion: 1,
      image: null,
      workspace: w,
    }),
  ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  await execute(
    b.id,
    w,
    randomUUID(),
    { type: "member.leave", confirmed: true },
    b.session,
  );
  await expect(
    readIdentityPhoto(b.id, b.session, w, a.id),
  ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  await changeIdentityPhoto(a.id, a.session, {
    ...v1,
    workspace: w,
    image: null,
    expectedVersion: 1,
  });
  await expect(readIdentityPhoto(a.id, a.session, w)).rejects.toMatchObject({
    code: "PHOTO_NOT_FOUND",
  });
});
