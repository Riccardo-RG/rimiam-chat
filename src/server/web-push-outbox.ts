import { randomUUID } from "node:crypto";
import type { Tx } from "./db.ts";

export type PushReference =
  | {
      kind: "personal_research";
      id: string;
      version: number;
      recipient: string;
    }
  | { kind: "message"; id: string }
  | { kind: "work"; id: string; version: number; actor: string | null }
  | { kind: "followup"; id: string; version: number; recipient: string }
  | { kind: "followup.chat"; id: string; version: number; messageId: string };

// Only a delivered occurrence with its own durable Conversation message can
// fan out to Workspace members. Historical owner-only receipts have no message.
export async function sharedReminderForMessage(
  tx: Tx,
  workspaceId: string,
  messageId: string,
  version: number,
): Promise<string | undefined> {
  const match = await tx.query<{ followup_id: string }>(
    `SELECT d.followup_id FROM followup_delivery d
     JOIN message m ON (m.workspace_id,m.id)=(d.workspace_id,d.message_id)
     WHERE d.workspace_id=$1 AND d.message_id=$2 AND d.version=$3
       AND d.outcome='delivered' AND m.actor_kind='miriam' AND m.purpose='followup_reminder'`,
    [workspaceId, messageId, version],
  );
  return match.rows[0]?.followup_id;
}

export async function queuePushDelivery(tx: Tx, id: string, at?: Date) {
  await tx.query(
    "SELECT graphile_worker.add_job('web_push',json_build_object('id',$1::text),max_attempts:=1,job_key:=$2,run_at:=$3)",
    [id, `web-push:${id}`, at ?? new Date()],
  );
}

// Runs inside the same transaction as workspace_change. No historical backfill,
// inferred consent, provider call, or dependence on current VAPID availability.
export async function queueWorkspacePush(
  tx: Tx,
  w: string,
  revision: number,
  event: string,
  hint?: PushReference,
) {
  let kind: string,
    reference: string,
    version = 1;
  let exclude: string | null = null,
    recipient: string | null = null;
  if (
    hint?.kind === "message" &&
    ["message.send", "voice.sent", "miriam.responded"].includes(event)
  ) {
    // A single command may append both a human message and an immediate reply.
    const message = (
      await tx.query(
        "SELECT id,author_id FROM message WHERE workspace_id=$1 AND id=$2 AND actor_kind=$3",
        [w, hint.id, event === "miriam.responded" ? "miriam" : "human"],
      )
    ).rows[0];
    if (!message) return;
    kind = event === "miriam.responded" ? "result" : "message";
    reference = message.id;
    exclude = message.author_id;
  } else if (
    hint?.kind === "work" &&
    ["work.completed", "work.needs_input"].includes(event)
  ) {
    kind = event;
    reference = hint.id;
    version = hint.version;
    exclude = hint.actor;
  } else if (hint?.kind === "followup" && event === "followup.delivered") {
    kind = "followup";
    reference = hint.id;
    version = hint.version;
    recipient = hint.recipient;
  } else if (hint?.kind === "followup.chat" && event === "followup.delivered") {
    if (
      (await sharedReminderForMessage(tx, w, hint.messageId, hint.version)) !==
      hint.id
    )
      return;
    kind = "followup.chat";
    reference = hint.messageId;
    version = hint.version;
  } else if (
    hint?.kind === "personal_research" &&
    event === "research.brief.ready"
  ) {
    if (
      !(
        await tx.query(
          "SELECT 1 FROM personal_research_preference p JOIN personal_research_brief b ON b.work_id=p.work_id AND b.generation=$3 AND b.status='ready' WHERE p.workspace_id=$1 AND p.work_id=$2 AND p.actor_id=$4 AND p.notify",
          [w, hint.id, hint.version, hint.recipient],
        )
      ).rowCount
    )
      return;
    kind = "personal_research";
    reference = hint.id;
    version = hint.version;
    recipient = hint.recipient;
  } else return;
  const devices = (
    await tx.query(
      `SELECT d.id,d.version,p.version AS preference_version FROM web_push_opt_in p
     JOIN web_push_device d ON d.id=p.device_id
     JOIN membership m ON m.workspace_id=p.workspace_id AND m.user_id=d.user_id
     JOIN "user" u ON u.id=d.user_id JOIN session s ON s.id=d.session_id AND s."userId"=d.user_id
     WHERE p.workspace_id=$1 AND p.enabled AND d.enabled AND m.active AND m.version=p.membership_version
     AND u.eligible AND u."emailVerified" AND s."expiresAt">clock_timestamp()
     AND ($2::text IS NULL OR d.user_id<>$2) AND ($3::text IS NULL OR d.user_id=$3)
     AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM followup_delivery fd
       JOIN followup_version fv ON (fv.workspace_id,fv.followup_id,fv.version)=(fd.workspace_id,fd.followup_id,fd.version)
       JOIN membership_history h ON h.workspace_id=fd.workspace_id AND h.user_id=m.user_id AND h.version=m.version AND h.active
       WHERE fd.workspace_id=m.workspace_id AND fd.message_id=$4 AND h.created_at<=GREATEST(fd.scheduled_at,fv.created_at)))`,
      [w, exclude, recipient, kind === "followup.chat" ? reference : null],
    )
  ).rows;
  for (const device of devices) {
    const id = randomUUID();
    const inserted = await tx.query(
      `INSERT INTO web_push_delivery(id,device_id,device_version,preference_version,workspace_id,revision,kind,reference_id,reference_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(device_id,workspace_id,revision) DO NOTHING RETURNING id`,
      [
        id,
        device.id,
        device.version,
        device.preference_version,
        w,
        revision,
        kind,
        reference,
        version,
      ],
    );
    if (inserted.rowCount) await queuePushDelivery(tx, id);
  }
}
