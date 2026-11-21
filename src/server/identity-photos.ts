import sharp from "sharp";
import { z } from "zod";
import {
  type PhotoChange,
  photoChangeSchema,
  photoDirectorySchema,
} from "../contracts/identity-photos.ts";
import { transaction, type Tx } from "./db.ts";
import { DomainError, requireThat } from "./errors.ts";
import { body } from "./http.ts";
import {
  authenticatedSession,
  changed,
  eligible,
  lockWorkspace,
  member,
} from "./workspace-state.ts";

const empty = { version: 0, present: false };
export async function identityPhotoDirectory(
  actor: string,
  session: string,
  workspace?: string,
) {
  return transaction(async (tx) => {
    await authenticatedSession(tx, actor, session);
    await eligible(tx, actor, true);
    if (workspace) await member(tx, workspace, actor);
    const self = await tx.query(
      "SELECT version, image IS NOT NULL AS present FROM profile_photo WHERE owner_id=$1",
      [actor],
    );
    const rooms = await tx.query(
      "SELECT p.workspace_id AS id,p.version,p.image IS NOT NULL AS present FROM workspace_photo p JOIN membership m USING(workspace_id) WHERE m.user_id=$1 AND m.active",
      [actor],
    );
    const members = workspace
      ? (
          await tx.query(
            'SELECT p.owner_id AS id,p.version,p.image IS NOT NULL AS present FROM profile_photo p JOIN membership m ON m.user_id=p.owner_id JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.active AND u.eligible AND u."emailVerified"',
            [workspace],
          )
        ).rows
      : [];
    const index = (rows: { id: string; version: number; present: boolean }[]) =>
      Object.fromEntries(
        rows.map(({ id, version, present }) => [id, { version, present }]),
      );
    return photoDirectorySchema.parse({
      actor,
      own: self.rows[0] ?? empty,
      rooms: index(rooms.rows),
      members: index(members),
    });
  });
}
async function authorizeChange(
  tx: Tx,
  actor: string,
  session: string,
  w?: string,
) {
  if (w) {
    const row = await lockWorkspace(tx, w);
    await authenticatedSession(tx, actor, session);
    await member(tx, w, actor, true, true);
    requireThat(!row.personal_owner_id, "WORKSPACE_ACCESS_DENIED", 403);
  } else {
    await authenticatedSession(tx, actor, session);
    await tx.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [actor]);
    await eligible(tx, actor);
  }
}
export async function normalizeIdentityImage(encoded: string) {
  const raw = Buffer.from(encoded, "base64");
  // Require the JPEG our Web clients produce. SVG, HTML and animated formats are never served.
  requireThat(
    raw.length > 4 && raw[0] === 255 && raw[1] === 216 && raw[2] === 255,
    "INVALID_PHOTO",
    400,
  );
  try {
    const read = sharp(raw, {
      limitInputPixels: 4096 * 4096,
      failOn: "warning",
    });
    const meta = await read.metadata();
    requireThat(meta.format === "jpeg" && !meta.pages, "INVALID_PHOTO", 400);
    return await read
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .jpeg({ quality: 83 })
      .toBuffer();
  } catch {
    throw new DomainError("INVALID_PHOTO", 400);
  }
}
export async function changeIdentityPhoto(
  actor: string,
  session: string,
  input: PhotoChange,
) {
  requireThat(input.expectedActorId === actor, "AUTH_CONTEXT_CHANGED", 409);
  // Reject unauthorized uploads before doing image processing. Recheck under the final write lock.
  await transaction((tx) =>
    authorizeChange(tx, actor, session, input.workspace),
  );
  const bytes = input.image ? await normalizeIdentityImage(input.image) : null;
  return transaction(async (tx) => {
    const w = input.workspace;
    await authorizeChange(tx, actor, session, w);
    const previous = w
      ? await tx.query(
          "SELECT version, image FROM workspace_photo WHERE workspace_id=$1",
          [w],
        )
      : await tx.query(
          "SELECT version, image FROM profile_photo WHERE owner_id=$1",
          [actor],
        );
    const current = previous.rows[0];
    const version = current?.version ?? 0;
    const same = bytes ? current?.image?.equals(bytes) : !current?.image;
    if (same) return { version, present: !!bytes };
    requireThat(
      version === input.expectedVersion,
      "PHOTO_VERSION_CHANGED",
      409,
    );
    if (w) {
      await tx.query(
        "INSERT INTO workspace_photo(workspace_id,version,image,changed_by) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id) DO UPDATE SET version=EXCLUDED.version,image=EXCLUDED.image,changed_by=EXCLUDED.changed_by,changed_at=clock_timestamp()",
        [w, version + 1, bytes, actor],
      );
      await changed(tx, w, "workspace.photo");
    } else {
      await tx.query(
        "INSERT INTO profile_photo(owner_id,version,image) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET version=EXCLUDED.version,image=EXCLUDED.image,changed_at=clock_timestamp()",
        [actor, version + 1, bytes],
      );
    }
    return { version: version + 1, present: !!bytes };
  });
}
export async function readIdentityPhoto(
  actor: string,
  session: string,
  w?: string,
  person?: string,
) {
  return transaction(async (tx) => {
    await authenticatedSession(tx, actor, session);
    await eligible(tx, actor, true);
    if (w) {
      await member(tx, w, actor);
      if (person) await member(tx, w, person);
    } else requireThat(person === actor, "PHOTO_NOT_FOUND", 404);
    const photo = person
      ? await tx.query("SELECT image FROM profile_photo WHERE owner_id=$1", [
          person,
        ])
      : await tx.query(
          "SELECT image FROM workspace_photo WHERE workspace_id=$1",
          [w],
        );
    requireThat(photo.rows[0]?.image, "PHOTO_NOT_FOUND", 404);
    return photo.rows[0].image as Buffer;
  });
}
export async function identityPhotoEndpoint(
  request: Request,
  url: URL,
  actor: string,
  session: string,
  headers: Record<string, string>,
) {
  if (request.method === "POST")
    return Response.json(
      await changeIdentityPhoto(
        actor,
        session,
        photoChangeSchema.parse(await body(request, 500000)),
      ),
      { headers },
    );
  requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
  const workspace = z
    .uuid()
    .optional()
    .parse(url.searchParams.get("workspace") ?? undefined);
  if (!url.searchParams.has("image"))
    return Response.json(
      await identityPhotoDirectory(actor, session, workspace),
      { headers },
    );
  const person = z
    .string()
    .min(1)
    .max(256)
    .optional()
    .parse(url.searchParams.get("person") ?? undefined);
  const bytes = await readIdentityPhoto(actor, session, workspace, person);
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...headers,
      "Content-Type": "image/jpeg",
      "Content-Disposition": "inline",
    },
  });
}
