import { randomUUID } from "node:crypto";
import type { Tx } from "./db.ts";

// The calling command owns the Workspace lock, the exact new version and its journal event.
export async function recordWorkspaceNotice(
  tx: Tx,
  w: string,
  actor: string,
  text: string,
  reference: { kind: "goal" | "workstream"; id: string; version: number },
) {
  const messageId = randomUUID();
  await tx.query(
    `WITH seq AS (UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message),
     notice AS (INSERT INTO message(workspace_id,id,sequence,author_id,purpose,content)
       SELECT $1,$2,next_message,$3,$4,$5 FROM seq RETURNING id)
     INSERT INTO message_context_reference(workspace_id,message_id,kind,reference_id,reference_version)
       SELECT $1,id,$6,$7,$8 FROM notice`,
    [
      w,
      messageId,
      actor,
      reference.kind === "goal" ? "goal_event" : "workstream_event",
      text,
      reference.kind,
      reference.id,
      reference.version,
    ],
  );
  return messageId;
}
