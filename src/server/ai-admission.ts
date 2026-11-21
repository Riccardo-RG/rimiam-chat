import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.ts";
import { DomainError, requireThat } from "./errors.ts";

const limitsSchema = z.object({
  minute: z.coerce.number().int().min(0).max(1000000).default(20),
  day: z.coerce.number().int().min(0).max(1000000).default(500),
  workspaceDay: z.coerce.number().int().min(0).max(1000000).default(200),
});

/** Reserve before dispatch; failure/unknown outcome never refunds an attempt.
 * These rolling invocation limits do not truncate context or certify dollar cost.
 * The global lock serializes admission only, never model execution or Active Work.
 */
export async function admitAIInvocation(
  operation:
    | "conversation"
    | "active_work"
    | "vision"
    | "transcription"
    | "email_composition"
    | "direct_recap"
    | "private_recap"
    | "private_research"
    | "private_document",
  workspace?: string,
  directChat?: string,
) {
  const parsed = limitsSchema.safeParse({
    minute: process.env.AI_MAX_INVOCATIONS_PER_MINUTE,
    day: process.env.AI_MAX_INVOCATIONS_PER_DAY,
    workspaceDay: process.env.AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY,
  });
  if (!parsed.success)
    throw new DomainError("AI_LIMIT_CONFIGURATION_INVALID", 503);
  const limits = parsed.data;
  return transaction(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('rimiam:ai-admission',0))",
    );
    const {
      rows: [counts],
    } = await tx.query<{ minute: number; day: number; workspace_day: number }>(
      `SELECT count(*) FILTER(WHERE admitted_at>clock_timestamp()-interval '1 minute')::integer AS minute,
       count(*)::integer AS day,
       count(*) FILTER(WHERE coalesce(w.personal_archive_id,a.workspace_id)=(SELECT coalesce(x.personal_archive_id,x.id) FROM workspace x WHERE x.id=$1) OR direct_chat_id=$2)::integer AS workspace_day
       FROM ai_invocation_admission a LEFT JOIN workspace w ON w.id=a.workspace_id WHERE admitted_at>clock_timestamp()-interval '24 hours'`,
      [workspace ?? null, directChat ?? null],
    );
    requireThat(
      counts.minute < limits.minute &&
        counts.day < limits.day &&
        (!(workspace || directChat) ||
          counts.workspace_day < limits.workspaceDay),
      "AI_USAGE_LIMIT_REACHED",
      429,
    );
    const id = randomUUID();
    await tx.query(
      "INSERT INTO ai_invocation_admission(id,workspace_id,operation,direct_chat_id) VALUES($1,$2,$3,$4)",
      [id, workspace ?? null, operation, directChat ?? null],
    );
    return id;
  });
}
