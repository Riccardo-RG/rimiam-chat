import type { z } from "zod";
import type { workstreamFocusSchema } from "../contracts/attention.ts";
import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";

type Focus = z.infer<typeof workstreamFocusSchema>;
export interface WorkstreamFocusContext extends Focus {
  title: string;
  description: string;
  currentVersion: number;
  currentState: "proposed" | "active" | "resolved" | "archived";
}
export interface FocusDependencies extends WorkstreamFocusContext {
  linksFingerprint: string;
  dependencySourceIds: string[];
}

// Caller holds the Workspace command lock and has checked contribution eligibility.
export async function recordMessageFocus(
  tx: Tx,
  w: string,
  message: string,
  actor: string,
  focus: Focus,
  source = message,
) {
  const stream = (
    await tx.query(
      "SELECT current_version,state FROM workstream WHERE workspace_id=$1 AND id=$2",
      [w, focus.workstreamId],
    )
  ).rows[0];
  requireThat(stream, "WORKSTREAM_NOT_FOUND", 404);
  requireThat(stream.current_version === focus.version, "STATE_STALE");
  requireThat(stream.state === "active", "WORKSTREAM_NOT_ACTIVE");
  await tx.query(
    "INSERT INTO message_workstream_focus(workspace_id,message_id,workstream_id,workstream_version) VALUES($1,$2,$3,$4)",
    [w, message, focus.workstreamId, focus.version],
  );
  await tx.query(
    "INSERT INTO workstream_source(workspace_id,workstream_id,source_id,version,included,actor_id,origin) VALUES($1,$2,$3,1,true,$4,'human')",
    [w, focus.workstreamId, source, actor],
  );
}

export async function requireReadableWorkstream(
  tx: Tx,
  w: string,
  id: string | undefined,
) {
  if (!id) return;
  requireThat(
    (
      await tx.query(
        "SELECT 1 FROM workstream WHERE workspace_id=$1 AND id=$2",
        [w, id],
      )
    ).rowCount,
    "WORKSTREAM_NOT_FOUND",
    404,
  );
}

// Shared by versioned sync and the web snapshot. Replies reference the original human source;
// they are neither independent evidence nor duplicated messages in a child Conversation.
export const messageFocusJoin = `LEFT JOIN message_workstream_focus mf ON mf.workspace_id=m.workspace_id AND mf.message_id=COALESCE(
 (SELECT v.message_id FROM voice_message v WHERE v.workspace_id=m.workspace_id AND v.source_id=m.reply_to_source_id),m.reply_to_source_id,m.id)`;
export const messageFocusProjection = `CASE WHEN mf.message_id IS NULL THEN NULL ELSE jsonb_build_object('workstreamId',mf.workstream_id,'version',mf.workstream_version) END`;
export const focusedMessagePredicate = `($5::uuid IS NULL OR EXISTS (
 SELECT 1 FROM workstream_source link WHERE link.workspace_id=m.workspace_id AND link.workstream_id=$5
 AND (link.source_id=COALESCE(m.reply_to_source_id,m.id) OR link.source_id IN
   (SELECT source_id FROM voice_message WHERE workspace_id=m.workspace_id AND message_id=m.id))
 AND link.included AND NOT EXISTS (SELECT 1 FROM workstream_source newer
   WHERE (newer.workspace_id,newer.workstream_id,newer.source_id)=(link.workspace_id,link.workstream_id,link.source_id) AND newer.version>link.version)))`;

export async function focusedContext(
  tx: Tx,
  w: string,
  source: string,
  dependencySourceIds: string[] = [],
): Promise<FocusDependencies | null> {
  const focus = (
    await tx.query<Omit<FocusDependencies, "dependencySourceIds">>(
      `SELECT f.workstream_id AS "workstreamId",f.workstream_version AS version,v.title,v.description,
      w.current_version AS "currentVersion",w.state AS "currentState",
      COALESCE((SELECT md5(string_agg(l.source_id::text||':'||l.version||':'||l.included::text,',' ORDER BY l.source_id))
        FROM (SELECT DISTINCT ON(source_id) source_id,version,included FROM workstream_source
          WHERE workspace_id=f.workspace_id AND workstream_id=f.workstream_id AND source_id=ANY($3::uuid[]) ORDER BY source_id,version DESC) l),'') AS "linksFingerprint"
    FROM message_workstream_focus f
    JOIN workstream w ON (w.workspace_id,w.id)=(f.workspace_id,f.workstream_id)
    JOIN workstream_version v ON (v.workspace_id,v.workstream_id,v.version)=(f.workspace_id,f.workstream_id,f.workstream_version)
    WHERE f.workspace_id=$1 AND (f.message_id=$2 OR EXISTS (SELECT 1 FROM voice_message voice WHERE voice.workspace_id=f.workspace_id AND voice.message_id=f.message_id AND voice.source_id=$2))`,
      [w, source, dependencySourceIds],
    )
  ).rows[0];
  return focus ? { ...focus, dependencySourceIds } : null;
}

export async function focusedSources(
  tx: Tx,
  w: string,
  workstream: string,
  terms: string[],
) {
  // Recent linked sources + all lexical matches form a starting selection. Retained linked and
  // unlinked shared history remains searchable through needsMore, never an access/token cutoff.
  return (
    await tx.query(
      `WITH linked AS (
      SELECT s.*,NOT EXISTS(SELECT 1 FROM external_source newer WHERE newer.workspace_id=s.workspace_id AND newer.document_id=s.document_id AND newer.document_version>s.document_version) AS current FROM workspace_source s JOIN (SELECT DISTINCT ON(source_id) source_id,included
        FROM workstream_source WHERE workspace_id=$1 AND workstream_id=$2 ORDER BY source_id,version DESC) l
        ON l.source_id=s.id AND l.included WHERE s.workspace_id=$1
    ), selected AS (
      (SELECT * FROM linked ORDER BY created_at DESC,id LIMIT 12)
      UNION SELECT * FROM linked WHERE EXISTS (SELECT 1 FROM unnest($3::text[]) t
        WHERE t=$2::text OR id::text=t OR content ILIKE '%'||t||'%' OR title ILIKE '%'||t||'%')
    ) SELECT * FROM selected ORDER BY created_at,id`,
      [w, workstream, terms],
    )
  ).rows;
}

export function sameFocusDependencies(
  before: Awaited<ReturnType<typeof focusedContext>>,
  after: Awaited<ReturnType<typeof focusedContext>>,
) {
  return (
    (!before && !after) ||
    (!!before &&
      !!after &&
      before.currentVersion === after.currentVersion &&
      before.currentState === after.currentState &&
      before.linksFingerprint === after.linksFingerprint)
  );
}
