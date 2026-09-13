import { pool, transaction } from "./db.ts";
import { lockWorkspace, changed } from "./workspace-state.ts";
import { followupAt, followupValid } from "./tasks-state.ts";
import { enqueueFollowup } from "./tasks-commands.ts";

export async function processFollowup(w: string, id: string, version: number) {
  return transaction(async (tx) => {
    await lockWorkspace(tx, w);
    const v = await followupAt(tx, w, id);
    if (v.version !== version || v.status !== "active") return "obsolete";
    if (
      (
        await tx.query(
          "SELECT 1 FROM followup_delivery WHERE workspace_id=$1 AND followup_id=$2 AND version=$3",
          [w, id, version],
        )
      ).rowCount
    )
      return "already_processed";
    if (
      !(
        await tx.query("SELECT 1 WHERE $1::timestamptz<=clock_timestamp()", [
          v.remind_at,
        ])
      ).rowCount
    ) {
      await enqueueFollowup(tx, w, id, version, v.remind_at.toISOString());
      return "not_due";
    }
    const valid = await followupValid(tx, v),
      outcome = valid ? "delivered" : "suppressed";
    await tx.query(
      "INSERT INTO followup_delivery(workspace_id,followup_id,version,outcome,reason) VALUES($1,$2,$3,$4,$5)",
      [
        w,
        id,
        version,
        outcome,
        valid
          ? "In-app reminder only; no consequential effect."
          : "Current access or referenced state requires explicit review.",
      ],
    );
    await changed(tx, w, "followup." + outcome);
    return outcome;
  });
}
export async function recoverFollowups() {
  const due = (
    await pool.query(
      `SELECT v.workspace_id,v.followup_id,v.version,v.remind_at FROM workspace_followup f JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version) WHERE v.status='active' AND v.remind_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM followup_delivery d WHERE (d.workspace_id,d.followup_id,d.version)=(v.workspace_id,v.followup_id,v.version)) ORDER BY v.remind_at LIMIT 500`,
    )
  ).rows;
  for (const v of due)
    await transaction((tx) =>
      enqueueFollowup(
        tx,
        v.workspace_id,
        v.followup_id,
        v.version,
        v.remind_at.toISOString(),
      ),
    );
}
