import { readyPersonalResearch } from "./personal-research.ts";
import { randomUUID } from "node:crypto";
import { transaction, type Tx } from "./db.ts";
import {
  member,
  eligible,
  authenticatedSession,
  lockWorkspace,
  changed,
} from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import { openPersonalThread } from "./commands.ts";
import { workspaceConsultation } from "./private-consultation.ts";
import type { StructuredModel } from "./structured-llm.ts";
import type {
  ChatDirectory,
  ChatState,
  PersonalChatInput,
} from "../contracts/personal-chats.ts";

async function owned(tx: Tx, thread: string, actor: string, session: string) {
  await authenticatedSession(tx, actor, session);
  const w = await lockWorkspace(tx, thread);
  requireThat(w.personal_owner_id === actor, "PERSONAL_CHAT_UNAVAILABLE", 404);
  await member(tx, thread, actor, true, true);
  return w;
}
export async function chatDirectory(
  actor: string,
  session: string,
  q = "",
  offset = 0,
): Promise<ChatDirectory> {
  return transaction(async (tx) => {
    await eligible(tx, actor, true);
    await authenticatedSession(tx, actor, session);
    const {
      rows: [archive],
    } = await tx.query(
      "SELECT w.id,r.thread_id FROM workspace w LEFT JOIN personal_chat_resume r ON r.actor_id=w.personal_owner_id WHERE w.personal_owner_id=$1 AND w.personal_archive_id IS NULL",
      [actor],
    );
    const needle = q.trim().slice(0, 160);
    const rows = (
      await tx.query(
        `SELECT w.id,COALESCE(s.content,'Nuova conversazione') AS label,COALESCE(last.at,w.created_at) AS at FROM workspace w
 JOIN membership a ON a.workspace_id=w.id AND a.user_id=$1 AND a.active
 LEFT JOIN LATERAL(SELECT m.content FROM message m WHERE m.workspace_id=w.id AND m.actor_kind='human' ORDER BY sequence LIMIT 1)s ON true
 LEFT JOIN LATERAL(SELECT max(created_at) AS at FROM message WHERE workspace_id=w.id)last ON true
 WHERE w.personal_owner_id=$1 AND ($2='' OR EXISTS(SELECT 1 FROM message m WHERE m.workspace_id=w.id AND m.purpose='conversation' AND strpos(lower(m.content),lower($2))>0))
 ORDER BY at DESC,w.id LIMIT 26 OFFSET $3`,
        [actor, needle, offset],
      )
    ).rows;
    const ready = await readyPersonalResearch(tx, actor);
    return {
      archive: archive?.id ?? null,
      active: archive?.thread_id ?? archive?.id ?? null,
      threads: rows.slice(0, 25).map((r) => ({
        id: r.id,
        label: r.label.slice(0, 90),
        at: r.at.toISOString(),
      })),
      more: rows.length > 25,
      ready,
    };
  });
}
async function selection(tx: Tx, thread: string, actor: string) {
  const row = (
    await tx.query(
      `SELECT CASE WHEN r.admission=c.admission AND m.active THEN w.id END AS id,CASE WHEN r.admission=c.admission AND m.active THEN w.name END AS label,c.version FROM personal_chat_consultation c
 LEFT JOIN workspace w ON w.id=c.target_id AND w.personal_owner_id IS NULL
 LEFT JOIN conversation_reading r ON r.workspace_id=w.id AND r.user_id=$2 LEFT JOIN membership m ON m.workspace_id=w.id AND m.user_id=$2 WHERE c.thread_id=$1`,
      [thread, actor],
    )
  ).rows[0];
  return row ?? { id: null, label: null, version: 0 };
}
export async function personalChatState(
  actor: string,
  session: string,
  thread: string,
): Promise<ChatState> {
  return transaction(async (tx) => {
    const w = await owned(tx, thread, actor, session);
    const targets = (
      await tx.query(
        "SELECT w.id,w.name,m.contributes FROM workspace w JOIN membership m ON m.workspace_id=w.id AND m.user_id=$1 AND m.active WHERE w.personal_owner_id IS NULL ORDER BY w.name,w.id",
        [actor],
      )
    ).rows;
    const turns = (
      await tx.query(
        `SELECT t.id,t.selection_version AS "selectionVersion",t.message_id AS "messageId",t.target_id AS target,source.content AS question,CASE WHEN NOT COALESCE(m.active AND r.admission=t.admission,false) THEN 'unavailable' ELSE COALESCE(c.status,'pending') END AS status,
 CASE WHEN m.active AND r.admission=t.admission AND c.status='ready' THEN c.answer END AS answer,
 CASE WHEN m.active AND r.admission=t.admission AND c.status='ready' THEN c.references_json ELSE '[]'::jsonb END AS references
 FROM personal_consultation_turn t JOIN message source ON source.workspace_id=t.thread_id AND source.id=t.message_id
 LEFT JOIN private_workspace_consultation c ON c.id=t.id AND c.workspace_id=t.target_id AND c.actor_id=t.actor_id
 LEFT JOIN membership m ON m.workspace_id=t.target_id AND m.user_id=t.actor_id LEFT JOIN conversation_reading r ON r.workspace_id=t.target_id AND r.user_id=t.actor_id WHERE t.thread_id=$1 AND t.actor_id=$2 ORDER BY t.created_at,t.id`,
        [thread, actor],
      )
    ).rows;
    const research = (
      await tx.query(
        `SELECT w.id,w.request_source_id AS "messageId",(b.work_id IS NOT NULL) AS brief,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'url',x.url) ORDER BY x.created_at,x.id) FROM external_source x WHERE x.workspace_id=w.workspace_id AND x.work_id=w.id AND x.work_generation=w.generation AND x.id=ANY(b.cited_ids)),'[]'::jsonb) AS citations,w.generation,w.query,COALESCE(b.status,w.status) AS status,p.notify,p.origin_id AS origin,(p.read_at IS NOT NULL) AS read,b.summary,COALESCE(b.error_code,w.error_code) AS error,
 ARRAY(SELECT destination_id FROM personal_research_publication s WHERE s.workspace_id=w.workspace_id AND s.work_id=w.id AND s.generation=w.generation) AS shared
 FROM research_work w JOIN personal_research_preference p ON p.workspace_id=w.workspace_id AND p.work_id=w.id LEFT JOIN personal_research_brief b ON b.work_id=w.id AND b.generation=w.generation WHERE w.workspace_id=$1 AND p.actor_id=$2 ORDER BY w.created_at DESC`,
        [thread, actor],
      )
    ).rows;
    return {
      archive: w.personal_archive_id ?? thread,
      selection: await selection(tx, thread, actor),
      targets,
      turns,
      research,
    };
  });
}
export async function personalChatAct(
  actor: string,
  session: string,
  input: PersonalChatInput,
  model?: StructuredModel,
) {
  requireThat(input.expectedActorId === actor, "AUTH_CONTEXT_CHANGED", 409);
  if (input.action === "open" || input.action === "new")
    return transaction((tx) =>
      openPersonalThread(
        tx,
        actor,
        session,
        input.thread,
        input.action === "new",
      ),
    );
  if (input.action === "research_read")
    return transaction(async (tx) => {
      await owned(tx, input.thread, actor, session);
      const consumed = await tx.query(
        "UPDATE personal_research_preference p SET read_at=coalesce(p.read_at,now()) FROM personal_research_brief b WHERE b.work_id=p.work_id AND b.status='ready' AND p.workspace_id=$1 AND p.work_id=$2 AND p.actor_id=$3",
        [input.thread, input.workId, actor],
      );
      requireThat(consumed.rowCount, "RESEARCH_UNAVAILABLE", 404);
      return {};
    });
  await transaction(async (tx) => {
    await owned(tx, input.thread, actor, session);
    const current = await selection(tx, input.thread, actor);
    requireThat(
      current.version === input.expectedVersion,
      "CONSULTATION_SELECTION_CHANGED",
      409,
    );
    const target = input.target;
    const admission = target
      ? (
          await tx.query(
            `SELECT r.admission FROM conversation_reading r JOIN workspace w ON w.id=r.workspace_id AND w.personal_owner_id IS NULL
 JOIN membership m ON m.workspace_id=r.workspace_id AND m.user_id=r.user_id AND m.active WHERE r.workspace_id=$1 AND r.user_id=$2 FOR SHARE OF m`,
            [target, actor],
          )
        ).rows[0]?.admission
      : null;
    requireThat(!target || admission, "WORKSPACE_ACCESS_DENIED", 403);
    if (input.action === "select") {
      await tx.query(
        "INSERT INTO personal_chat_consultation(thread_id,target_id,admission,version) VALUES($1,$2,$3,1) ON CONFLICT(thread_id) DO UPDATE SET target_id=excluded.target_id,admission=excluded.admission,version=personal_chat_consultation.version+1",
        [input.thread, target, admission],
      );
      return;
    }
    requireThat(
      current.id === input.target,
      "CONSULTATION_SELECTION_CHANGED",
      409,
    );
    const previous = (
      await tx.query(
        "SELECT t.*,m.content FROM personal_consultation_turn t JOIN message m ON m.workspace_id=t.thread_id AND m.id=t.message_id WHERE t.id=$1",
        [input.id],
      )
    ).rows[0];
    if (previous) {
      requireThat(
        previous.thread_id === input.thread &&
          previous.actor_id === actor &&
          previous.target_id === input.target &&
          previous.admission === admission &&
          previous.selection_version === current.version &&
          previous.content === input.question,
        "COMMAND_ID_REUSED",
      );
      return;
    }
    const message = randomUUID();
    await tx.query(
      `WITH seq AS(UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message)
   INSERT INTO message(id,workspace_id,sequence,author_id,content) SELECT $2,$1,next_message,$3,$4 FROM seq`,
      [input.thread, message, actor, input.question],
    );
    await tx.query(
      "INSERT INTO personal_consultation_turn(id,thread_id,message_id,actor_id,target_id,admission,selection_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        input.id,
        input.thread,
        message,
        actor,
        input.target,
        admission,
        current.version,
      ],
    );
    await changed(tx, input.thread, "personal.consultation");
  });
  if (input.action === "ask") {
    await workspaceConsultation(
      actor,
      session,
      input.target,
      {
        action: "ask",
        kind: "context",
        id: input.id,
        expectedActorId: actor,
        question: input.question,
      },
      model,
      async (tx) => {
        await tx.query(
          "SELECT 1 FROM personal_chat_consultation WHERE thread_id=$1 FOR SHARE",
          [input.thread],
        );
        const current = await selection(tx, input.thread, actor);
        requireThat(
          current.id === input.target &&
            current.version === input.expectedVersion,
          "CONSULTATION_SELECTION_CHANGED",
          409,
        );
      },
      (tx) =>
        tx
          .query<{ question: string; answer: string }>(
            `SELECT c.question,c.answer
       FROM personal_consultation_turn t JOIN private_workspace_consultation c ON c.id=t.id AND c.workspace_id=t.target_id AND c.actor_id=t.actor_id AND c.admission=t.admission
       WHERE t.thread_id=$1 AND t.target_id=$2 AND t.actor_id=$3 AND t.selection_version=$4 AND c.status='ready'
       AND t.created_at<(SELECT created_at FROM personal_consultation_turn WHERE id=$5)
       ORDER BY t.created_at DESC,t.id LIMIT 2`,
            [
              input.thread,
              input.target,
              actor,
              input.expectedVersion,
              input.id,
            ],
          )
          .then((r) => r.rows.reverse()),
    );
    // An intervening departure or account restriction also fences the result on read.
  }
  return {};
}
