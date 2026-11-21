import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";

export async function lockPushRegistrations(tx: Tx, actor: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "web-push-user:" + actor,
  ]);
  // Expired, deleted and offline-logout sessions cannot deliver or consume a device slot.
  await tx.query(
    `UPDATE web_push_device d SET enabled=false,version=version+1,updated_at=now()
    WHERE d.user_id=$1 AND d.enabled AND NOT EXISTS(SELECT 1 FROM session s
      WHERE s.id=d.session_id AND s."userId"=d.user_id AND s."expiresAt">clock_timestamp())`,
    [actor],
  );
}
export async function requirePushDeviceSlot(tx: Tx, actor: string) {
  const count = await tx.query(
    "SELECT count(*)::int AS n FROM web_push_device WHERE user_id=$1 AND enabled",
    [actor],
  );
  requireThat(count.rows[0].n < 20, "PUSH_DEVICE_LIMIT", 409);
}
export async function resetDeviceOptIns(tx: Tx, device: string) {
  await tx.query(
    "UPDATE web_push_opt_in SET enabled=false,version=version+1 WHERE device_id=$1 AND enabled",
    [device],
  );
}
export async function optIntoWorkspace(
  tx: Tx,
  device: string,
  workspace: string,
  actor: string,
) {
  await tx.query(
    `INSERT INTO web_push_opt_in(device_id,workspace_id,membership_version)
    SELECT $1,workspace_id,version FROM membership WHERE workspace_id=$2 AND user_id=$3 AND active
    ON CONFLICT(device_id,workspace_id) DO UPDATE SET membership_version=EXCLUDED.membership_version,
      enabled=true,version=web_push_opt_in.version+1,opted_at=now()
    WHERE NOT web_push_opt_in.enabled OR web_push_opt_in.membership_version<>EXCLUDED.membership_version`,
    [device, workspace, actor],
  );
}
