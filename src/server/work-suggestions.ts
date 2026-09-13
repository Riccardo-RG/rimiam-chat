import type { z } from "zod";
import type { workSuggestionCommandSchema } from "../contracts/active-work.ts";
import type { Tx } from "./db.ts";
import { authenticatedSession, member } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import { applyActiveWork } from "./active-work-commands.ts";
export async function applyWorkSuggestion(
  tx: Tx,
  w: string,
  actor: string,
  c: z.infer<typeof workSuggestionCommandSchema>,
  session?: string,
) {
  await member(tx, w, actor, true, true);
  await authenticatedSession(tx, actor, session);
  const suggestion = (
    await tx.query(
      "SELECT * FROM work_control_suggestion WHERE workspace_id=$1 AND id=$2",
      [w, c.suggestionId],
    )
  ).rows[0];
  requireThat(suggestion, "WORK_SUGGESTION_NOT_FOUND", 404);
  requireThat(
    !(
      await tx.query(
        "SELECT 1 FROM work_control_application WHERE workspace_id=$1 AND suggestion_id=$2",
        [w, c.suggestionId],
      )
    ).rowCount,
    "WORK_SUGGESTION_ALREADY_APPLIED",
  );
  const instruction = [
    "input",
    "assumption",
    "objection",
    "redirect",
    "format",
  ].includes(suggestion.operation)
    ? (suggestion.operation as
        "input" | "assumption" | "objection" | "redirect" | "format")
    : undefined;
  const control = { pause: "pausa", stop: "stop", resume: "riprendi" };
  const result = await applyActiveWork(
    tx,
    w,
    actor,
    {
      type: "work.converse",
      workId: suggestion.work_id,
      expectedRevision: suggestion.expected_revision,
      text: instruction
        ? suggestion.content
        : control[suggestion.operation as keyof typeof control],
      ...(instruction ? { instruction } : {}),
    },
    session,
  );
  requireThat(
    "messageId" in result && typeof result.messageId === "string",
    "WORK_CONTROL_APPLICATION_INVALID",
  );
  const revision = (
    await tx.query(
      "SELECT revision FROM active_work WHERE workspace_id=$1 AND id=$2",
      [w, suggestion.work_id],
    )
  ).rows[0].revision;
  await tx.query(
    "INSERT INTO work_control_application(workspace_id,suggestion_id,actor_id,source_id,resulting_revision) VALUES($1,$2,$3,$4,$5)",
    [w, c.suggestionId, actor, result.messageId, revision],
  );
  return { ...result, suggestionId: c.suggestionId };
}
