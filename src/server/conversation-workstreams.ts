import { randomUUID } from "node:crypto";
import type { ConversationOperation } from "../contracts/conversation-operation.ts";
import { workstreamNameKey } from "../shared/workstream-intent.ts";
import { attentionCommand } from "./attention.ts";
import type { Tx } from "./db.ts";
import { changed, member } from "./workspace-state.ts";

// Caller holds the Workspace lock and validated the currently authenticated human session.
export async function createConversationWorkstream(
  tx: Tx,
  w: string,
  actor: string,
  source: string,
  title: string,
) {
  await member(tx, w, actor, true, true);
  const matches = (
    await tx.query(
      `SELECT s.id,s.state,s.current_version,v.title FROM workstream s JOIN workstream_version v
    ON (v.workspace_id,v.workstream_id,v.version)=(s.workspace_id,s.id,s.current_version) WHERE s.workspace_id=$1`,
      [w],
    )
  ).rows.filter(
    (row) => workstreamNameKey(row.title) === workstreamNameKey(title),
  );
  let result: ConversationOperation;
  if (!matches.length) {
    const created = await attentionCommand(tx, w, actor, {
      type: "workstream.save",
      title,
      description: "",
    });
    result = {
      outcome: "created",
      title,
      workstreamId: created.id,
      workstreamVersion: created.version,
    };
  } else if (matches.length === 1 && matches[0].state === "active") {
    const existing = matches[0];
    result = {
      outcome: "existing",
      title: existing.title,
      workstreamId: existing.id,
      workstreamVersion: existing.current_version,
    };
  } else result = { outcome: "needs_input", title };
  if (result.workstreamId) {
    // A focused send can already have linked the same immutable source. Preserve its attribution.
    const link = (
      await tx.query(
        "SELECT version,included FROM workstream_source WHERE workspace_id=$1 AND workstream_id=$2 AND source_id=$3 ORDER BY version DESC LIMIT 1",
        [w, result.workstreamId, source],
      )
    ).rows[0];
    if (!link)
      await attentionCommand(tx, w, actor, {
        type: "workstream.link",
        workstreamId: result.workstreamId,
        sourceId: source,
        expectedVersion: 0,
        included: true,
      });
  }
  const content =
    result.outcome === "created"
      ? `Ho creato il filone «${result.title}». È una vista della Conversation condivisa: non è una chat privata e non cambia Goal, impegni o permessi.`
      : result.outcome === "existing"
        ? `Il filone «${result.title}» è già attivo. Ho collegato questa richiesta al filone esistente, senza crearne un duplicato.`
        : `Esiste già un filone con il nome «${title}», ma non posso scegliere o riattivarlo implicitamente. Apri Filoni per selezionarlo e, se necessario, attivarlo o riaprirlo; oppure chiedimi un filone con un nome diverso. Non ho creato o modificato alcun filone.`;
  const replyMessageId = randomUUID();
  const seq = (
    await tx.query(
      "UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message",
      [w],
    )
  ).rows[0].next_message;
  await tx.query(
    "INSERT INTO message(id,workspace_id,sequence,author_id,actor_kind,content,reply_to_source_id) VALUES($1,$2,$3,NULL,'miriam',$4,$5)",
    [replyMessageId, w, seq, content, source],
  );
  await tx.query(
    "INSERT INTO conversation_workstream_action(workspace_id,source_message_id,reply_message_id,actor_id,title,outcome,workstream_id,workstream_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      w,
      source,
      replyMessageId,
      actor,
      result.title,
      result.outcome,
      result.workstreamId ?? null,
      result.workstreamVersion ?? null,
    ],
  );
  await changed(tx, w, "message.send");
  return { replyMessageId, operationResult: result };
}
