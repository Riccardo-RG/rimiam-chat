import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";

export interface WorkspaceRow {
  id: string;
  revision: number;
  context_revision: number;
  access_revision: number;
  next_message: number;
}
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
    "SELECT contributes FROM membership WHERE workspace_id=$1 AND user_id=$2 AND active",
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
) {
  const r = await tx.query(
    "UPDATE workspace SET revision=revision+1,context_revision=context_revision+$2,access_revision=access_revision+$3 WHERE id=$1 RETURNING revision",
    [w, Number(context), Number(access)],
  );
  await tx.query(
    "INSERT INTO workspace_change(workspace_id,revision,kind) VALUES($1,$2,$3)",
    [w, r.rows[0].revision, kind],
  );
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
    'SELECT id FROM session WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp() FOR SHARE',
    [sessionId, actor],
  );
  requireThat(s.rowCount, "AUTHENTICATION_REQUIRED", 401);
  return sessionId;
}
