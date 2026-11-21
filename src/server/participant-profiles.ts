import { transaction, type Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { authenticatedSession, eligible, member } from "./workspace-state.ts";
import type {
  ParticipantProfile,
  ChangeOwnProfile,
} from "../contracts/participant-profile.ts";

// Callers must establish the viewer's current relationship to this person first.
export async function readProfile(
  tx: Tx,
  person: string,
): Promise<ParticipantProfile> {
  const { rows } = await tx.query<ParticipantProfile>(
    `SELECT u.id,u.name,u.email,p.phone,coalesce(p.version,0) AS version
       FROM "user" u LEFT JOIN profile_contact p ON p.owner_id=u.id
      WHERE u.id=$1 AND u.eligible AND u."emailVerified" FOR SHARE OF u`,
    [person],
  );
  requireThat(rows[0], "PROFILE_NOT_AVAILABLE", 404);
  return rows[0];
}

export async function ownProfile(
  actor: string,
  session: string,
  change?: ChangeOwnProfile,
) {
  return transaction(async (tx) => {
    await authenticatedSession(tx, actor, session);
    if (change) {
      requireThat(
        change.expectedActorId === actor,
        "AUTH_CONTEXT_CHANGED",
        409,
      );
      // Serialize the first write as well as updates while eligibility can change.
      await tx.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [actor]);
    }
    await eligible(tx, actor, true);
    const profile = await readProfile(tx, actor);
    if (!change) return profile;
    requireThat(
      profile.version === change.expectedVersion,
      "PROFILE_VERSION_CHANGED",
      409,
    );
    if (change.phone === profile.phone) return profile;
    await tx.query(
      `INSERT INTO profile_contact(owner_id,phone,version) VALUES($1,$2,1)
       ON CONFLICT(owner_id) DO UPDATE SET phone=excluded.phone,version=profile_contact.version+1`,
      [actor, change.phone],
    );
    return { ...profile, phone: change.phone, version: profile.version + 1 };
  });
}

export async function workspaceProfile(
  actor: string,
  session: string,
  workspace: string,
  person: string,
) {
  return transaction(async (tx) => {
    await authenticatedSession(tx, actor, session);
    await member(tx, workspace, actor, false, true);
    const members = await tx.query(
      "SELECT user_id FROM membership WHERE workspace_id=$1 AND user_id=ANY($2::text[]) AND active ORDER BY user_id FOR SHARE",
      [workspace, [actor, person]],
    );
    requireThat(
      members.rows.some((m) => m.user_id === actor),
      "WORKSPACE_ACCESS_DENIED",
      403,
    );
    requireThat(
      members.rows.some((m) => m.user_id === person),
      "PROFILE_NOT_AVAILABLE",
      404,
    );
    return readProfile(tx, person);
  });
}
