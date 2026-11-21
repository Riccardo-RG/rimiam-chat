import { transaction, type Tx } from "./db.ts";
import { member } from "./workspace-state.ts";
import { conversationReferenceSchema } from "../contracts/activity.ts";
import { requireThat } from "./errors.ts";
import { workAt, openIssues } from "./active-work-state.ts";
import {
  activeWorkViewSchema,
  activeWorkHistorySchema,
  activeWorkPresenceSchema,
} from "../contracts/active-work.ts";

function contract(row: Record<string, unknown>) {
  return {
    version: row.version,
    objective: row.objective,
    scope: row.scope,
    expectedOutput: row.expected_output,
    anchors: row.anchors,
    focus: row.focus,
    actor: row.actor_id,
    origin: row.origin,
    sourceId: row.source_id,
    reason: row.reason,
    createdAt: (row.created_at as Date).toISOString(),
  };
}
function contribution(row: Record<string, unknown>) {
  return {
    id: row.id,
    generation: row.generation,
    contractVersion: row.contract_version,
    body: row.body,
    objective: row.objective,
    citations: row.citation_keys,
    qualification: row.qualification,
    createdAt: (row.created_at as Date).toISOString(),
  };
}
async function contributionSources(
  tx: Tx,
  w: string,
  work: string,
  generation: number,
  keys: string[],
) {
  const { rows } = await tx.query(
    `SELECT i.input_key,i.kind,i.reference_id,i.reference_version,i.content,i.qualification,i.provenance,
       s.title AS source_title,act.proposal_id
     FROM active_work_input i
     LEFT JOIN external_source s ON i.kind='source' AND (s.workspace_id,s.id)=(i.workspace_id,i.reference_id)
     LEFT JOIN project_act act ON i.kind='commitment' AND (act.workspace_id,act.id)=(i.workspace_id,i.reference_id)
     WHERE (i.workspace_id,i.work_id,i.generation)=($1,$2,$3) AND i.input_key=ANY($4::text[])
     ORDER BY array_position($4::text[],i.input_key)`,
    [w, work, generation, keys],
  );
  return rows.map((i) => {
    const routed =
      i.provenance.reference ??
      (i.kind === "commitment"
        ? { kind: "commitment", id: i.proposal_id, version: 1 }
        : {
            kind:
              i.kind === "workstream_focus"
                ? "workstream"
                : i.kind === "temporal_scheduled_event"
                  ? "scheduled_event"
                  : i.kind,
            id: i.reference_id,
            version: i.reference_version,
          });
    const parsed = conversationReferenceSchema.safeParse(routed);
    const label =
      String(i.source_title || i.content)
        .split("\n")[0]
        .trim() || "Fonte citata";
    return {
      key: i.input_key,
      label: label.length > 100 ? label.slice(0, 99) + "…" : label,
      reference: parsed.success ? parsed.data : null,
      excerpt: parsed.success ? null : i.content + "\n" + i.qualification,
    };
  });
}
async function events(
  tx: Tx,
  w: string,
  id: string | null,
  before: number = 2147483647,
) {
  return (
    await tx.query(
      `SELECT id,work_id AS "workId",revision,contract_version AS "contractVersion",kind,content,actor_id AS actor,source_id AS "sourceId",created_at AS "createdAt" FROM active_work_event WHERE workspace_id=$1 AND ($2::uuid IS NULL OR work_id=$2) AND revision<$3 ORDER BY created_at DESC,id DESC LIMIT 50`,
      [w, id, before],
    )
  ).rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
export async function activeWorkPresence(actor: string, w: string) {
  return transaction(async (tx) => {
    await member(tx, w, actor, false, true);
    const ongoing = await tx.query(
      `SELECT a.id, c.objective, a.phase, a.error_code IS NOT NULL AS blocked
       FROM active_work a JOIN active_work_contract c ON
         (c.workspace_id,c.work_id,c.version)=(a.workspace_id,a.id,a.contract_version)
       WHERE a.workspace_id=$1 AND a.phase IN ('queued','working','needs_input','paused')
       ORDER BY CASE a.phase WHEN 'needs_input' THEN 0 WHEN 'working' THEN 1
         WHEN 'queued' THEN 2 ELSE 3 END, a.created_at DESC, a.id DESC LIMIT 6`,
      [w],
    );
    const results = await tx.query(
      `SELECT a.id, c.objective, r.id AS "contributionId", a.validity
       FROM active_work a JOIN active_work_contract c ON
         (c.workspace_id,c.work_id,c.version)=(a.workspace_id,a.id,a.contract_version)
       JOIN LATERAL (SELECT id,created_at FROM active_work_contribution
         WHERE workspace_id=a.workspace_id AND work_id=a.id AND contract_version=c.version
         ORDER BY generation DESC LIMIT 1) r ON TRUE
       WHERE a.workspace_id=$1 AND a.phase='completed'
       ORDER BY r.created_at DESC,r.id DESC LIMIT 3`,
      [w],
    );
    return activeWorkPresenceSchema.parse({
      ongoing: ongoing.rows,
      results: results.rows,
    });
  });
}
export async function activeWorkView(
  actor: string,
  w: string,
  before?: string,
  workId?: string,
  completion?: number,
) {
  return transaction(async (tx) => {
    await member(tx, w, actor);
    const rows = workId
      ? [await workAt(tx, w, workId)]
      : (
          await tx.query(
            "SELECT * FROM active_work WHERE workspace_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM active_work WHERE workspace_id=$1 AND id=$2)) ORDER BY created_at DESC,id DESC LIMIT 21",
            [w, before ?? null],
          )
        ).rows;
    const works = [];
    for (const a of rows.slice(0, 20)) {
      const c = (
        await tx.query(
          "SELECT * FROM active_work_contract WHERE workspace_id=$1 AND work_id=$2 AND version=$3",
          [w, a.id, a.contract_version],
        )
      ).rows[0];
      const result = completion
        ? (
            await tx.query(
              `SELECT r.*,c.objective FROM active_work_event e
          JOIN active_work_contract c ON (c.workspace_id,c.work_id,c.version)=(e.workspace_id,e.work_id,e.contract_version)
          JOIN LATERAL
          (SELECT * FROM active_work_contribution r WHERE (r.workspace_id,r.work_id,r.contract_version)=(e.workspace_id,e.work_id,e.contract_version)
           AND r.created_at<=e.created_at ORDER BY r.generation DESC LIMIT 1) r ON true
          WHERE e.workspace_id=$1 AND e.work_id=$2 AND e.revision=$3 AND e.kind='completed'`,
              [w, a.id, completion],
            )
          ).rows[0]
        : (
            await tx.query(
              "SELECT * FROM active_work_contribution WHERE workspace_id=$1 AND work_id=$2 ORDER BY generation DESC LIMIT 1",
              [w, a.id],
            )
          ).rows[0];
      if (completion) requireThat(result, "ACTIVE_WORK_NOT_FOUND", 404);
      works.push({
        id: a.id,
        revision: a.revision,
        phase: a.phase,
        validity: a.validity,
        error: a.error_code,
        contract: contract(c),
        issues: (await openIssues(tx, w, a.id)).map((i) => ({
          id: i.id,
          kind: i.kind,
          content: i.content,
          actor: i.actor_id,
          proposedObjective: i.proposed_objective,
          requiredPeople: i.required_people,
          acknowledgedBy: i.acknowledged_by,
        })),
        contribution: result
          ? {
              ...contribution(result),
              sources: await contributionSources(
                tx,
                w,
                a.id,
                result.generation,
                result.citation_keys,
              ),
            }
          : null,
      });
    }
    const canControl =
      (
        await tx.query(
          "SELECT contributes FROM membership WHERE workspace_id=$1 AND user_id=$2 AND active",
          [w, actor],
        )
      ).rows[0]?.contributes === true;
    return activeWorkViewSchema.parse({
      works,
      events: await events(tx, w, workId ?? null),
      next: rows.length > 20 ? rows[19].id : null,
      canControl,
      suggestions: (
        await tx.query(
          `SELECT s.id,s.work_id AS "workId",s.expected_revision AS "expectedRevision",s.operation,s.content AS text,s.source_id AS "sourceId",s.interpretation_id AS "interpretationId",CASE WHEN a.suggestion_id IS NOT NULL THEN 'applied' WHEN w.revision=s.expected_revision THEN 'pending' ELSE 'stale' END AS status,a.actor_id AS "appliedBy",s.created_at AS "createdAt" FROM work_control_suggestion s JOIN active_work w ON (w.workspace_id,w.id)=(s.workspace_id,s.work_id) LEFT JOIN work_control_application a ON (a.workspace_id,a.suggestion_id)=(s.workspace_id,s.id) WHERE s.workspace_id=$1 AND s.work_id=ANY($2::uuid[]) ORDER BY s.created_at DESC`,
          [w, works.map((a) => a.id)],
        )
      ).rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    });
  });
}
export async function activeWorkHistory(
  actor: string,
  w: string,
  id: string,
  before: number = 2147483647,
) {
  return transaction(async (tx) => {
    await member(tx, w, actor);
    await workAt(tx, w, id);
    const page = await events(tx, w, id, before);
    const versions = [...new Set(page.map((e) => e.contractVersion))];
    const contracts = (
      await tx.query(
        "SELECT * FROM active_work_contract WHERE workspace_id=$1 AND work_id=$2 AND version=ANY($3::int[]) ORDER BY version DESC",
        [w, id, versions],
      )
    ).rows.map(contract);
    const contributions = (
      await tx.query(
        "SELECT * FROM active_work_contribution WHERE workspace_id=$1 AND work_id=$2 AND contract_version=ANY($3::int[]) ORDER BY generation DESC",
        [w, id, versions],
      )
    ).rows.map(contribution);
    const inputs = (
      await tx.query(
        `SELECT i.generation,i.input_key AS key,i.kind,i.reference_id AS id,i.reference_version AS version,i.content,i.qualification,i.provenance FROM active_work_input i JOIN active_work_attempt a USING(workspace_id,work_id,generation) WHERE i.workspace_id=$1 AND i.work_id=$2 AND a.contract_version=ANY($3::int[]) ORDER BY i.generation DESC,i.input_key`,
        [w, id, versions],
      )
    ).rows;
    const issueActs = (
      await tx.query(
        "SELECT a.id,a.issue_id,a.actor_id,a.action,a.membership_version,a.source_id,a.created_at FROM active_work_issue_act a JOIN active_work_issue i ON i.id=a.issue_id AND i.workspace_id=a.workspace_id WHERE a.workspace_id=$1 AND a.work_id=$2 AND i.contract_version=ANY($3::int[]) ORDER BY a.created_at",
        [w, id, versions],
      )
    ).rows;
    return activeWorkHistorySchema.parse({
      contracts,
      events: page,
      contributions,
      inputs,
      issueActs,
      nextBefore:
        page.length === 50 ? Math.min(...page.map((p) => p.revision)) : null,
    });
  });
}
