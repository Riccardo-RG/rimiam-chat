import { resolveMentionIds } from "../shared/conversation-mentions.ts";
import type {
  PersonalReading,
  ReadingInput,
  ConversationDirectoryEntry,
} from "../contracts/conversation-reading.ts";
import { transaction, type Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { authenticatedSession, changed, member } from "./workspace-state.ts";

// Messages skipped via "go to bottom" stay unread. The entry baseline affects
// attention only: it must never become a filter on accessible Workspace history.
const unreadMessages = `FROM message m WHERE m.workspace_id=r.workspace_id
  AND m.sequence>r.joined_sequence AND m.author_id IS DISTINCT FROM r.user_id
  AND m.purpose NOT IN ('workspace_welcome','workstream_event','goal_event')
  AND NOT EXISTS (SELECT FROM conversation_seen s WHERE (s.workspace_id,s.user_id,s.admission,s.message_id)
    =(r.workspace_id,r.user_id,r.admission,m.id))`;
const mentioned = `EXISTS (SELECT FROM conversation_mention t WHERE (t.workspace_id,t.message_id,t.recipient_id)=(m.workspace_id,m.id,r.user_id))`;
const requests = `FROM conversation_answer_request a JOIN message am ON (am.workspace_id,am.id)=(a.workspace_id,a.message_id)
  WHERE (a.workspace_id,a.recipient_id,a.recipient_admission)=(r.workspace_id,r.user_id,r.admission) AND a.resolved_at IS NULL`;

export async function workspaceDirectory(
  tx: Tx,
  actor: string,
): Promise<ConversationDirectoryEntry[]> {
  const result = await tx.query(
    `SELECT w.id,w.name,coalesce(last.created_at,w.created_at) AS "lastActivityAt",
      left(last.content,180) AS preview,counts.unread AS "unreadCount",counts.tagged AS "mentionCount",
      counts.first_mention AS "firstMentionId",alerts.total AS "requestCount",alerts.first_id AS "firstRequestId"
    FROM membership me JOIN workspace w ON w.id=me.workspace_id
    JOIN conversation_reading r USING(workspace_id,user_id)
    LEFT JOIN LATERAL (SELECT m.content,m.created_at FROM message m WHERE m.workspace_id=w.id
      AND m.purpose NOT IN ('workspace_welcome','workstream_event','goal_event') ORDER BY m.sequence DESC LIMIT 1) last ON true
    CROSS JOIN LATERAL (SELECT count(*)::int unread,count(*) FILTER(WHERE ${mentioned})::int tagged,
      (array_agg(m.id ORDER BY m.sequence) FILTER(WHERE ${mentioned}))[1] first_mention ${unreadMessages}) counts
    CROSS JOIN LATERAL (SELECT count(*)::int total, (array_agg(am.id ORDER BY am.sequence))[1] first_id ${requests}) alerts
    WHERE me.user_id=$1 AND me.active AND w.personal_owner_id IS NULL ORDER BY "lastActivityAt" DESC,w.id`,
    [actor],
  );
  return result.rows.map(
    (row) =>
      ({
        ...row,
        lastActivityAt: row.lastActivityAt.toISOString(),
      }) as ConversationDirectoryEntry,
  );
}
export async function personalReading(
  tx: Tx,
  w: string,
  actor: string,
): Promise<PersonalReading> {
  const result = await tx.query<PersonalReading>(
    `SELECT r.admission,r.anchor_id AS "anchorId",r.anchor_offset AS "anchorOffset",r.anchor_at_bottom AS "anchorAtBottom",
    r.cursor_version AS "cursorVersion",ARRAY(SELECT m.id ${unreadMessages} ORDER BY m.sequence) AS "unreadIds",
    ARRAY(SELECT m.id ${unreadMessages} AND ${mentioned} ORDER BY m.sequence) AS "mentionIds",
    ARRAY(SELECT am.id ${requests} ORDER BY am.sequence) AS "requestIds"
    FROM conversation_reading r WHERE r.workspace_id=$1 AND r.user_id=$2`,
    [w, actor],
  );
  requireThat(result.rows[0], "WORKSPACE_ACCESS_DENIED", 403);
  return result.rows[0];
}
export async function readPersonalAttention(
  actor: string,
  session: string,
  w: string,
) {
  return transaction(async (tx) => {
    await member(tx, w, actor, false, true);
    await authenticatedSession(tx, actor, session);
    return personalReading(tx, w, actor);
  });
}
export async function updateReading(
  actor: string,
  session: string,
  w: string,
  input: ReadingInput,
) {
  return transaction(async (tx) => {
    requireThat(actor === input.expectedActorId, "AUTH_CONTEXT_CHANGED", 409);
    await member(tx, w, actor, false, true);
    // Always lock membership before personal preferences. Departure and
    // re-admission cannot let a stale device acknowledge a new admission.
    const current = await tx.query(
      "SELECT active FROM membership WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
      [w, actor],
    );
    requireThat(current.rows[0]?.active, "WORKSPACE_ACCESS_DENIED", 403);
    await authenticatedSession(tx, actor, session);
    const state = await tx.query(
      "SELECT admission,cursor_version FROM conversation_reading WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE",
      [w, actor],
    );
    requireThat(
      state.rows[0]?.admission === input.admission,
      "READING_ADMISSION_CHANGED",
      409,
    );
    const ids = [...new Set(input.seen)];
    if (ids.length) {
      const visible = await tx.query(
        "SELECT id FROM message WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
        [w, ids],
      );
      requireThat(visible.rowCount === ids.length, "MESSAGE_NOT_FOUND", 404);
      await tx.query(
        `INSERT INTO conversation_seen(workspace_id,user_id,admission,message_id)
        SELECT $1,$2,$3,id FROM message WHERE workspace_id=$1 AND id=ANY($4::uuid[]) ON CONFLICT DO NOTHING`,
        [w, actor, input.admission, ids],
      );
    }
    let cursorVersion: number = state.rows[0].cursor_version;
    if (input.anchor && input.anchor.expectedVersion === cursorVersion) {
      const a = input.anchor;
      const updated = await tx.query(
        `UPDATE conversation_reading SET anchor_id=$3,anchor_offset=$4,anchor_at_bottom=$5,cursor_version=cursor_version+1
        WHERE workspace_id=$1 AND user_id=$2 AND EXISTS (SELECT FROM message WHERE workspace_id=$1 AND id=$3) RETURNING cursor_version`,
        [w, actor, a.id, a.offset, a.atBottom ?? false],
      );
      requireThat(updated.rows[0], "MESSAGE_NOT_FOUND", 404);
      cursorVersion = updated.rows[0].cursor_version;
    }
    return { cursorVersion };
  });
}

export function addressedMembers(
  content: string,
  people: { id: string; name: string }[],
  selected: string[] = [],
) {
  const resolved = resolveMentionIds(content, people, selected);
  requireThat(
    selected.every((id) => resolved.includes(id)),
    "MENTION_NOT_AVAILABLE",
    409,
  );
  return resolved;
}
export async function recordConversationAddressing(
  tx: Tx,
  w: string,
  actor: string,
  id: string,
  content: string,
  options: { quoteMessageId?: string; mentionIds?: string[] },
) {
  if (options.quoteMessageId) {
    const result = await tx.query(
      `INSERT INTO conversation_quote(workspace_id,message_id,quoted_id)
      SELECT $1,$2,id FROM message WHERE workspace_id=$1 AND id=$3 AND id<>$2 RETURNING quoted_id`,
      [w, id, options.quoteMessageId],
    );
    requireThat(result.rowCount, "MESSAGE_NOT_FOUND", 404);
    await tx.query(
      `UPDATE conversation_answer_request a SET resolved_at=clock_timestamp(),reply_id=$4
      FROM conversation_reading r WHERE r.workspace_id=$1 AND r.user_id=$2 AND a.workspace_id=r.workspace_id AND a.recipient_id=r.user_id
      AND a.recipient_admission=r.admission AND a.message_id=$3 AND a.resolved_at IS NULL`,
      [w, actor, options.quoteMessageId, id],
    );
  }
  if (!content.includes("@") && !options.mentionIds?.length) return;
  const people = await tx.query<{ id: string; name: string }>(
    `SELECT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.user_id
    WHERE m.workspace_id=$1 AND m.active AND u.eligible AND u."emailVerified"`,
    [w],
  );
  const recipients = addressedMembers(
    content,
    people.rows,
    options.mentionIds,
  ).filter((recipient) => recipient !== actor);
  if (recipients.length)
    await tx.query(
      "INSERT INTO conversation_mention SELECT $1,$2,unnest($3::text[])",
      [w, id, recipients],
    );
}
export async function requestMessageAnswer(
  tx: Tx,
  w: string,
  actor: string,
  message: string,
  recipients: string[],
) {
  await member(tx, w, actor, true, true);
  requireThat(
    (
      await tx.query("SELECT FROM message WHERE workspace_id=$1 AND id=$2", [
        w,
        message,
      ])
    ).rowCount,
    "MESSAGE_NOT_FOUND",
    404,
  );
  const ids = [...new Set(recipients)];
  requireThat(!ids.includes(actor), "INVALID_ANSWER_RECIPIENT", 400);
  const people = await tx.query(
    `SELECT m.user_id,r.admission FROM membership m JOIN conversation_reading r USING(workspace_id,user_id)
    JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=ANY($2::text[]) AND m.active AND u.eligible AND u."emailVerified" FOR SHARE OF u`,
    [w, ids],
  );
  requireThat(people.rowCount === ids.length, "INVALID_ANSWER_RECIPIENT", 409);
  await tx.query(
    `INSERT INTO conversation_answer_request(workspace_id,message_id,recipient_id,requested_by,recipient_admission)
    SELECT $1,$2,user_id,$3,admission FROM conversation_reading WHERE workspace_id=$1 AND user_id=ANY($4::text[]) ON CONFLICT DO NOTHING`,
    [w, message, actor, ids],
  );
  await changed(tx, w, "conversation.requestAnswer");
}
export async function acknowledgeMessage(
  tx: Tx,
  w: string,
  actor: string,
  message: string,
) {
  const res = await tx.query(
    `UPDATE conversation_answer_request a SET resolved_at=coalesce(resolved_at,clock_timestamp()) FROM conversation_reading r
    WHERE (a.workspace_id,a.recipient_id,a.recipient_admission)=(r.workspace_id,r.user_id,r.admission)
      AND a.workspace_id=$1 AND a.recipient_id=$2 AND a.message_id=$3 RETURNING a.message_id`,
    [w, actor, message],
  );
  requireThat(res.rowCount, "ANSWER_REQUEST_NOT_FOUND", 404);
  await changed(tx, w, "conversation.answered");
}
export const quoteProjection = `(SELECT quoted_id FROM conversation_quote cq WHERE (cq.workspace_id,cq.message_id)=(m.workspace_id,m.id))`;
