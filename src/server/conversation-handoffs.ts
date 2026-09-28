import { randomUUID } from "node:crypto";
import type { Command } from "../contracts/commands.ts";
import {
  conversationHandoffsSchema,
  type HandoffSuggestion,
} from "../contracts/conversation-handoff.ts";
import type { ConversationReference } from "../contracts/activity.ts";
import type { InterpretationContext } from "./interpretation.ts";
import { transaction, type Tx } from "./db.ts";
import { authenticatedSession, member } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import { resolveReference } from "./conversation-reference.ts";

interface HandoffRow {
  id: string;
  workspace_id: string;
  source_id: string;
  source_message_id: string;
  kind: HandoffSuggestion["kind"];
  summary: string;
  suggested_text: string;
  target_kind: ConversationReference["kind"] | null;
  target_id: string | null;
  target_version: number | null;
  target_event_id: string | null;
  candidate_id: string | null;
  source_ids: string[];
  created_at: Date;
}
function target(row: HandoffRow): ConversationReference | null {
  return row.target_kind && row.target_id && row.target_version
    ? {
        kind: row.target_kind,
        id: row.target_id,
        version: row.target_version,
        ...(row.target_event_id ? { eventId: row.target_event_id } : {}),
      }
    : null;
}
function allowedTarget(s: HandoffSuggestion) {
  const expected = {
    "goal.change": "goal",
    "information.correct": "information",
    "project.replace": "commitment",
    "project.revoke": "commitment",
    "task.change": "task",
  }[s.kind as string];
  requireThat(
    expected ? s.target?.kind === expected : s.target === null,
    "HANDOFF_TARGET_MISMATCH",
  );
  requireThat(
    s.kind.startsWith("information.")
      ? s.candidateIndex !== null
      : s.candidateIndex === null || s.kind === "task.create",
    "HANDOFF_CANDIDATE_MISMATCH",
  );
}
function suppliedTarget(
  context: InterpretationContext,
  ref: ConversationReference,
) {
  if (
    context.objectReference &&
    JSON.stringify(context.objectReference.reference) === JSON.stringify(ref)
  )
    return true;
  if (ref.eventId) return false;
  const lists: Record<string, unknown[] | undefined> = {
    goal: context.goal,
    information: context.information,
    commitment: context.commitments,
    task: context.work,
  };
  return (lists[ref.kind] ?? []).some((value) => {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return (
      (ref.kind === "goal" ? row.goal_id : row.id) === ref.id &&
      (ref.kind === "commitment"
        ? ref.version === 1
        : (row.version ?? row.current_version) === ref.version)
    );
  });
}
export async function publishHandoffs(
  tx: Tx,
  w: string,
  interpretationId: string,
  generation: number,
  context: InterpretationContext,
  suggestions: HandoffSuggestion[],
  candidateIds: string[],
) {
  if (!suggestions.length) return;
  const human = (
    await tx.query<{ id: string }>(
      `SELECT m.id FROM message m WHERE m.workspace_id=$1 AND m.actor_kind='human' AND (m.id=$2 OR EXISTS(SELECT 1 FROM voice_message v WHERE v.workspace_id=m.workspace_id AND v.message_id=m.id AND v.source_id=$2))`,
      [w, context.trigger.id],
    )
  ).rows[0];
  requireThat(human, "HANDOFF_HUMAN_REQUEST_REQUIRED");
  const sources = new Set(context.sources.map((s) => s.id));
  for (const s of suggestions) {
    allowedTarget(s);
    requireThat(
      s.sourceIds.includes(context.trigger.id) &&
        s.sourceIds.every((id) => sources.has(id)),
      "INVALID_SOURCE_REFERENCE",
    );
    if (s.target) {
      requireThat(
        suppliedTarget(context, s.target),
        "HANDOFF_TARGET_NOT_SUPPLIED",
      );
      requireThat(
        (await resolveReference(tx, w, s.target)).current,
        "HANDOFF_TARGET_STALE",
      );
    }
    if (s.kind === "goal.establish")
      requireThat(
        !(await tx.query("SELECT 1 FROM goal WHERE workspace_id=$1", [w]))
          .rowCount,
        "HANDOFF_TARGET_STALE",
      );
    const candidateId =
      s.candidateIndex === null ? null : candidateIds[s.candidateIndex];
    requireThat(
      s.candidateIndex === null || candidateId,
      "HANDOFF_CANDIDATE_MISMATCH",
    );
    if (s.kind.startsWith("information.")) {
      const c = (
        await tx.query(
          "SELECT classification FROM candidate WHERE workspace_id=$1 AND id=$2",
          [w, candidateId],
        )
      ).rows[0];
      requireThat(
        c?.classification === "descriptive",
        "DESCRIPTIVE_CLARIFICATION_REQUIRED",
      );
    }
    await tx.query(
      `INSERT INTO conversation_handoff(id,workspace_id,source_id,source_message_id,interpretation_id,generation,kind,summary,suggested_text,target_kind,target_id,target_version,target_event_id,candidate_id,source_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        randomUUID(),
        w,
        context.trigger.id,
        human.id,
        interpretationId,
        generation,
        s.kind,
        s.summary,
        s.suggestedText,
        s.target?.kind ?? null,
        s.target?.id ?? null,
        s.target?.version ?? null,
        s.target?.eventId ?? null,
        candidateId,
        [...new Set(s.sourceIds)],
      ],
    );
  }
}
async function ready(tx: Tx, w: string, h: HandoffRow) {
  const ref = target(h);
  if (ref && !(await resolveReference(tx, w, ref)).current) return false;
  if (
    h.kind === "goal.establish" &&
    (await tx.query("SELECT 1 FROM goal WHERE workspace_id=$1", [w])).rowCount
  )
    return false;
  if (
    h.candidate_id &&
    !(
      await tx.query(
        "SELECT 1 FROM candidate c JOIN workspace w ON w.id=c.workspace_id WHERE c.workspace_id=$1 AND c.id=$2 AND c.context_revision=w.context_revision",
        [w, h.candidate_id],
      )
    ).rowCount
  )
    return false;
  return true;
}
export async function readHandoffs(tx: Tx, w: string, sourceId?: string) {
  const rows = (
    await tx.query<HandoffRow>(
      `SELECT * FROM conversation_handoff WHERE workspace_id=$1 AND ($2::uuid IS NULL OR source_id=$2 OR source_message_id=$2) ORDER BY created_at DESC,id DESC LIMIT CASE WHEN $2::uuid IS NULL THEN 100 ELSE NULL END`,
      [w, sourceId ?? null],
    )
  ).rows;
  const handoffs = [];
  for (const h of rows) {
    const a = (
      await tx.query(
        "SELECT * FROM conversation_handoff_application WHERE workspace_id=$1 AND handoff_id=$2",
        [w, h.id],
      )
    ).rows[0];
    const navigation = ["email.prepare", "calendar.prepare"].includes(h.kind);
    handoffs.push({
      id: h.id,
      sourceId: h.source_id,
      sourceMessageId: h.source_message_id,
      kind: h.kind,
      summary: h.summary,
      suggestedText: h.suggested_text,
      target: target(h),
      candidateId: h.candidate_id,
      sourceIds: h.source_ids,
      status: a
        ? "applied"
        : navigation
          ? "navigation"
          : (await ready(tx, w, h))
            ? "ready"
            : "stale",
      createdAt: h.created_at.toISOString(),
      application: a
        ? {
            actor: a.actor_id,
            commandId: a.command_id,
            commandType: a.command_type,
            createdAt: a.created_at.toISOString(),
            resultReference: a.result_kind
              ? {
                  kind: a.result_kind,
                  id: a.result_id,
                  version: a.result_version,
                }
              : null,
            prepared: a.prepared_kind
              ? { kind: a.prepared_kind, id: a.prepared_id }
              : null,
          }
        : null,
    });
  }
  return conversationHandoffsSchema.parse({ handoffs });
}
export async function handoffs(actor: string, w: string, sourceId?: string) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    return readHandoffs(tx, w, sourceId);
  });
}

// This validates provenance only. The existing capability command still owns all domain effects.
export async function validateHandoffOrigin(
  tx: Tx,
  w: string,
  actor: string,
  c: Command,
  session?: string,
) {
  if (!("conversationOrigin" in c) || !c.conversationOrigin) return null;
  await member(tx, w, actor, true, true);
  await authenticatedSession(tx, actor, session);
  const h = (
    await tx.query<HandoffRow>(
      "SELECT * FROM conversation_handoff WHERE workspace_id=$1 AND id=$2",
      [w, c.conversationOrigin.handoffId],
    )
  ).rows[0];
  requireThat(h, "HANDOFF_NOT_FOUND", 404);
  requireThat(
    !(
      await tx.query(
        "SELECT 1 FROM conversation_handoff_application WHERE workspace_id=$1 AND handoff_id=$2",
        [w, h.id],
      )
    ).rowCount,
    "HANDOFF_ALREADY_APPLIED",
  );
  requireThat(await ready(tx, w, h), "HANDOFF_TARGET_STALE");
  const ref = target(h);
  let matches = false;
  switch (c.type) {
    case "goal.establish":
      matches = h.kind === "goal.establish";
      break;
    case "goal.propose":
      matches =
        h.kind === "goal.change" &&
        ref?.id === c.goalId &&
        ref.version === c.expectedVersion;
      break;
    case "information.accept":
      matches =
        h.kind === "information.accept" && h.candidate_id === c.candidateId;
      break;
    case "information.correct":
      matches =
        h.kind === "information.correct" &&
        h.candidate_id === c.candidateId &&
        ref?.id === c.informationId &&
        ref.version === c.expectedVersion;
      break;
    case "task.create":
      matches =
        h.kind === "task.create" &&
        (!h.candidate_id || h.candidate_id === c.candidateId);
      break;
    case "task.revise":
    case "task.propose_revision":
      matches =
        h.kind === "task.change" &&
        ref?.id === c.taskId &&
        ref.version === c.expectedVersion;
      break;
    case "artifact.compose":
    case "artifact.from_contribution":
      matches = h.kind === "artifact.prepare";
      break;
    case "project.propose": {
      if (h.kind === "project.propose")
        matches = c.operation === "establish" && !c.replacesActId;
      else if (["project.replace", "project.revoke"].includes(h.kind) && ref) {
        const a = (
          await tx.query(
            "SELECT id FROM current_project_act WHERE workspace_id=$1 AND proposal_id=$2",
            [w, ref.id],
          )
        ).rows[0];
        matches =
          !!a &&
          c.replacesActId === a.id &&
          c.operation === (h.kind === "project.replace" ? "replace" : "revoke");
      }
      break;
    }
  }
  requireThat(matches, "HANDOFF_COMMAND_MISMATCH");
  return h;
}
export async function recordHandoffApplication(
  tx: Tx,
  w: string,
  actor: string,
  commandId: string,
  c: Command,
  h: HandoffRow,
  result: Record<string, unknown>,
) {
  let ref: ConversationReference | null = null,
    preparedKind: string | null = null,
    preparedId: string | null = null;
  const id = (key: string) => {
    const value = result[key];
    requireThat(typeof value === "string", "HANDOFF_RESULT_INVALID");
    return value;
  };
  const version = () => {
    requireThat(typeof result.version === "number", "HANDOFF_RESULT_INVALID");
    return result.version;
  };
  switch (c.type) {
    case "goal.establish":
      ref = { kind: "goal", id: id("goalId"), version: 1 };
      break;
    case "goal.propose":
      preparedKind = "goal_transition";
      preparedId = id("transitionId");
      break;
    case "project.propose":
      preparedKind = "project_proposal";
      preparedId = id("proposalId");
      ref = { kind: "commitment", id: preparedId, version: 1 };
      break;
    case "information.accept":
    case "information.correct":
      ref = {
        kind: "information",
        id: id("informationId"),
        version: version(),
      };
      break;
    case "task.create":
    case "task.revise":
      ref = { kind: "task", id: id("taskId"), version: version() };
      break;
    case "task.propose_revision":
      preparedKind = "task_revision_proposal";
      preparedId = id("proposalId");
      break;
    case "artifact.compose":
    case "artifact.from_contribution":
      ref = { kind: "artifact", id: id("artifactId"), version: version() };
      break;
    default:
      throw new Error("HANDOFF_COMMAND_MISMATCH");
  }
  await tx.query(
    `INSERT INTO conversation_handoff_application(workspace_id,handoff_id,actor_id,command_id,command_type,result_kind,result_id,result_version,prepared_kind,prepared_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      w,
      h.id,
      actor,
      commandId,
      c.type,
      ref?.kind ?? null,
      ref?.id ?? null,
      ref?.version ?? null,
      preparedKind,
      preparedId,
    ],
  );
}
