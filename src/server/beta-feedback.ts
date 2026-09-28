import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  type addBetaFeedbackSchema,
  betaFeedbackViewSchema,
} from "../contracts/beta-feedback.ts";
import { transaction, type Tx } from "./db.ts";
import { changed, lockWorkspace, member } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import { miriamSystemPrompt } from "./miriam-prompt.ts";

export async function addBetaFeedback(
  tx: Tx,
  workspace: string,
  actor: string,
  input: z.infer<typeof addBetaFeedbackSchema>,
) {
  await member(tx, workspace, actor, true, true);
  if (input.messageId) {
    const message = await tx.query(
      "SELECT id FROM message WHERE workspace_id=$1 AND id=$2",
      [workspace, input.messageId],
    );
    requireThat(message.rowCount, "FEEDBACK_MESSAGE_NOT_FOUND", 404);
  }
  const id = randomUUID();
  const mode = process.env.AI_MODE;
  const provider =
    mode === "openai" || mode === "anthropic" || mode === "ollama"
      ? mode
      : "unconfigured";
  // This is capture-time configuration, not inferred historical execution provenance.
  const model =
    provider === "unconfigured"
      ? null
      : ((provider === "ollama"
          ? process.env.OLLAMA_MODEL
          : process.env.AI_MODEL
        )
          ?.trim()
          .slice(0, 200) ?? null);
  const revision = process.env.APP_REVISION;
  await tx.query(
    `INSERT INTO beta_feedback(id,workspace_id,author_id,author_name,message_id,content,provider_at_capture,model_at_capture,conversation_prompt_hash_at_capture,app_revision_at_capture)
     SELECT $1,$2,$3,u.name,$4,$5,$6,$7,$8,$9 FROM "user" u WHERE u.id=$3`,
    [
      id,
      workspace,
      actor,
      input.messageId ?? null,
      input.content,
      provider,
      model,
      createHash("sha256").update(miriamSystemPrompt).digest("hex"),
      revision && /^[a-f0-9]{7,64}$/i.test(revision) ? revision : null,
    ],
  );
  await changed(tx, workspace, "beta.feedback");
  return { feedbackId: id };
}

export async function betaFeedbackView(actor: string, workspace: string) {
  return transaction(async (tx) => {
    await lockWorkspace(tx, workspace);
    await member(tx, workspace, actor, false, true);
    const name = await tx.query("SELECT name FROM workspace WHERE id=$1", [
      workspace,
    ]);
    const rows = await tx.query(
      `SELECT f.*,m.actor_kind AS message_actor_kind,m.content AS message_content,m.created_at AS message_created_at
       FROM beta_feedback f LEFT JOIN message m ON (m.workspace_id,m.id)=(f.workspace_id,f.message_id)
       WHERE f.workspace_id=$1 ORDER BY f.created_at,f.id LIMIT 1001`,
      [workspace],
    );
    // Operational protection: refuse rather than silently export a partial report.
    requireThat(rows.rows.length <= 1000, "FEEDBACK_REPORT_TOO_LARGE", 422);
    return betaFeedbackViewSchema.parse({
      workspaceId: workspace,
      workspaceName: name.rows[0].name,
      generatedAt: new Date().toISOString(),
      entries: rows.rows.map((row) => ({
        id: row.id,
        authorId: row.author_id,
        authorName: row.author_name,
        createdAt: row.created_at.toISOString(),
        content: row.content,
        message: row.message_id
          ? {
              id: row.message_id,
              actorKind: row.message_actor_kind,
              content: row.message_content,
              createdAt: row.message_created_at.toISOString(),
            }
          : null,
        configurationAtCapture: {
          provider: row.provider_at_capture,
          model: row.model_at_capture,
          conversationPromptHash: row.conversation_prompt_hash_at_capture,
          appRevision: row.app_revision_at_capture,
        },
      })),
    });
  });
}
