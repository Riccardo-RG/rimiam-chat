import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { queueWorkspacePush, type PushReference } from "./web-push-outbox.ts";

export interface WorkspaceRow {
  id: string;
  personal_owner_id?: string | null;
  personal_archive_id?: string | null;
  revision: number;
  context_revision: number;
  access_revision: number;
  next_message: number;
}
// Used for both link and inbox admission. A pending invitation from before a
// departure must not silently reopen access that was subsequently ended.
export const noDepartureSinceInvitation = `NOT EXISTS (
  SELECT 1 FROM membership_history h
  WHERE h.workspace_id = i.workspace_id AND h.user_id = $2
    AND NOT h.active AND h.created_at >= i.created_at
)`;
export async function eligible(tx: Tx, actor: string, protect = false) {
  const result = await tx.query(
    'SELECT id,email FROM "user" WHERE id=$1 AND eligible=true AND "emailVerified"=true' +
      (protect ? " FOR SHARE" : ""),
    [actor],
  );
  requireThat(result.rowCount, "ACCOUNT_INELIGIBLE", 403);
  return result.rows[0] as { id: string; email: string };
}
export async function member(
  tx: Tx,
  w: string,
  actor: string,
  contribute = false,
  protect = false,
) {
  await eligible(tx, actor, protect);
  const result = await tx.query(
    `SELECT m.contributes FROM membership m JOIN workspace w ON w.id=m.workspace_id
     WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.active AND (w.personal_owner_id IS NULL OR w.personal_owner_id=$2)`,
    [w, actor],
  );
  requireThat(
    result.rowCount && (!contribute || result.rows[0].contributes),
    "WORKSPACE_ACCESS_DENIED",
    403,
  );
}
export async function lockWorkspace(tx: Tx, w: string) {
  const result = await tx.query<WorkspaceRow>(
    "SELECT * FROM workspace WHERE id=$1 FOR UPDATE",
    [w],
  );
  requireThat(result.rowCount, "WORKSPACE_ACCESS_DENIED", 403);
  return result.rows[0];
}
export async function changed(
  tx: Tx,
  w: string,
  kind: string,
  context = false,
  access = false,
  pushReference?: PushReference,
) {
  const r = await tx.query(
    "UPDATE workspace SET revision=revision+1,context_revision=context_revision+$2,access_revision=access_revision+$3 WHERE id=$1 RETURNING revision",
    [w, Number(context), Number(access)],
  );
  await tx.query(
    "INSERT INTO workspace_change(workspace_id,revision,kind) VALUES($1,$2,$3)",
    [w, r.rows[0].revision, kind],
  );
  await queueWorkspacePush(tx, w, r.rows[0].revision, kind, pushReference);
}
export async function enqueue(tx: Tx, interpretationId: string) {
  await tx.query(
    "SELECT graphile_worker.add_job('interpret',json_build_object('interpretationId',$1::text),max_attempts:=5,job_key:=$2)",
    [interpretationId, `interpret:${interpretationId}`],
  );
}

export async function authenticatedSession(
  tx: Tx,
  actor: string,
  sessionId?: string,
) {
  requireThat(sessionId, "AUTHENTICATED_SESSION_REQUIRED", 401);
  const s = await tx.query(
    'SELECT id FROM session WHERE id=$1 AND "userId"=$2 FOR SHARE',
    [sessionId, actor],
  );
  requireThat(s.rowCount, "AUTHENTICATION_REQUIRED", 401);
  // A competing revocation/update may hold this row. Check expiration after
  // obtaining its lock, rather than accepting a predicate evaluated before wait.
  const current = await tx.query(
    'SELECT "expiresAt">clock_timestamp() AS valid FROM session WHERE id=$1',
    [sessionId],
  );
  requireThat(current.rows[0]?.valid, "AUTHENTICATION_REQUIRED", 401);
  return sessionId;
}
