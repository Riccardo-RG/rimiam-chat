import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.ts";
import { lockWorkspace, changed } from "./workspace-state.ts";
import {
  followupAt,
  followupRecurrence,
  followupValid,
  followupZone,
  nextFollowupOccurrence,
} from "./tasks-state.ts";
import { enqueueFollowup } from "./tasks-commands.ts";

export async function processFollowup(
  w: string,
  id: string,
  version: number,
  scheduledAt?: string,
) {
  return transaction(async (tx) => {
    await lockWorkspace(tx, w);
    const v = await followupAt(tx, w, id);
    if (v.version !== version || v.status !== "active") return "obsolete";
    const rule = followupRecurrence(v);
    const due = v.scheduled_instant as string | null;
    if (!due) return "already_processed";
    // Pre-042 jobs have only a version and apply exclusively to a one-shot.
    // A late job for one occurrence cannot advance another occurrence.
    if (!scheduledAt && rule) return "obsolete";
    const clock = (
      await tx.query<{
        observed_at: string;
        due: boolean;
        expired: boolean;
        matches: boolean;
      }>(
        `SELECT observed_at::text, $1::timestamptz<=observed_at AS due,
       COALESCE((observed_at AT TIME ZONE $2)::date > $3::date,false) AS expired,
       ($4::timestamptz IS NULL OR $4::timestamptz=$1::timestamptz) AS matches
       FROM (SELECT clock_timestamp() AS observed_at) clock`,
        [
          due,
          rule ? followupZone(v.time_zone) : "UTC",
          rule?.until ?? null,
          scheduledAt ?? null,
        ],
      )
    ).rows[0];
    if (!clock.matches) return "obsolete";
    if (!clock.due) {
      await enqueueFollowup(tx, w, id, version, due, !!rule);
      return "not_due";
    }
    const closed = (
      await tx.query(
        "SELECT 1 FROM followup_occurrence_change WHERE workspace_id=$1 AND followup_id=$2 AND version=$3 AND scheduled_at=$4",
        [w, id, version, due],
      )
    ).rowCount;
    const allowed = !clock.expired && (await followupValid(tx, v));
    const outcome = clock.expired
      ? "expired"
      : allowed && !closed
        ? "delivered"
        : "suppressed";
    const reason = {
      delivered: "Scheduled reminder posted to this Workspace Conversation.",
      suppressed: closed
        ? "The owner closed or replaced this occurrence."
        : "Current access or referenced state requires explicit review.",
      expired: "The local end date passed before delivery; no notification.",
    }[outcome];
    const messageId = outcome === "delivered" ? randomUUID() : null;
    if (messageId)
      await tx.query(
        `WITH next AS (UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message)
         INSERT INTO message(id,workspace_id,sequence,author_id,actor_kind,purpose,content)
         SELECT $2,$1,next_message,NULL,'miriam','followup_reminder',$3 FROM next`,
        [w, messageId, `Promemoria: ${v.content}`],
      );
    await tx.query(
      "INSERT INTO followup_delivery(workspace_id,followup_id,version,scheduled_at,delivered_at,outcome,reason,message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [w, id, version, due, clock.observed_at, outcome, reason, messageId],
    );
    // One wake-up covers all missed dates. Neither a retry nor recovery
    // updates the user's version or takes action on the referenced object.
    let next =
      rule && allowed
        ? await nextFollowupOccurrence(
            tx,
            v.schedule_anchor,
            v.time_zone,
            rule,
            clock.observed_at,
          )
        : null;
    if (
      next &&
      (
        await tx.query(
          "SELECT 1 FROM followup_series_split WHERE workspace_id=$1 AND followup_id=$2 AND effective_at<=$3",
          [w, id, next],
        )
      ).rowCount
    )
      next = null;
    await tx.query(
      "UPDATE workspace_followup SET next_remind_at=$3 WHERE workspace_id=$1 AND id=$2",
      [w, id, next],
    );
    if (next) await enqueueFollowup(tx, w, id, version, next, true);
    await changed(
      tx,
      w,
      "followup." + outcome,
      false,
      false,
      messageId ? { kind: "followup.chat", id, version, messageId } : undefined,
    );
    return outcome;
  });
}
export async function recoverFollowups() {
  const due = (
    await pool.query(
      `SELECT f.workspace_id,f.id,f.current_version,f.next_remind_at::text AS scheduled_instant,(v.recurrence_weekdays IS NOT NULL) AS recurring
       FROM workspace_followup f JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version)
       WHERE v.status='active' AND f.next_remind_at<=clock_timestamp() ORDER BY f.next_remind_at LIMIT 500`,
    )
  ).rows;
  for (const v of due)
    await transaction((tx) =>
      enqueueFollowup(
        tx,
        v.workspace_id,
        v.id,
        v.current_version,
        v.scheduled_instant,
        v.recurring,
      ),
    );
}
