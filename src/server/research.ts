import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, type Tx } from "./db.ts";
import {
  changed,
  lockWorkspace,
  member,
  type WorkspaceRow,
} from "./workspace-state.ts";
import { requireThat, DomainError } from "./errors.ts";
import { scheduleSource } from "./sources.ts";
import {
  configuredResearchProvider,
  researchResultsSchema,
  type ResearchProvider,
} from "./research-provider.ts";

import {
  researchRequestSchema,
  researchControlSchema,
} from "../contracts/commands.ts";
export {
  researchRequestSchema,
  researchControlSchema,
} from "../contracts/commands.ts";
async function event(
  tx: Tx,
  w: string,
  workId: string,
  generation: number,
  status: string,
  actor: string | null = null,
  detail: string | null = null,
) {
  await tx.query(
    "INSERT INTO research_event(id,workspace_id,work_id,generation,status,actor_id,detail) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [randomUUID(), w, workId, generation, status, actor, detail],
  );
  await changed(tx, w, `research.${status}`);
}
async function wakeup(tx: Tx, workId: string) {
  await tx.query(
    "SELECT graphile_worker.add_job('research',json_build_object('workId',$1::text),max_attempts:=1,job_key:=$2)",
    [workId, `research:${workId}`],
  );
}
async function membershipVersion(tx: Tx, w: string, actor: string) {
  return (
    await tx.query(
      "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
      [w, actor],
    )
  ).rows[0]?.version as number;
}
export async function requestResearch(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: z.infer<typeof researchRequestSchema>,
) {
  const w = ws.id;
  await member(tx, w, actor, true, true);
  const queued = await tx.query(
    "SELECT 1 FROM research_work WHERE workspace_id=$1 AND status IN ('queued','running')",
    [w],
  );
  requireThat((queued.rowCount ?? 0) < 4, "RESEARCH_BUSY");
  const recent = await tx.query(
    "SELECT 1 FROM research_event WHERE workspace_id=$1 AND status='queued' AND created_at>now()-interval '1 hour'",
    [w],
  );
  requireThat((recent.rowCount ?? 0) < 20, "RESEARCH_USAGE_LIMIT");
  requireThat(
    Boolean(c.questionId) === Boolean(c.questionVersion),
    "QUESTION_REFERENCE_INCOMPLETE",
  );
  if (c.questionId)
    requireThat(
      (
        await tx.query(
          "SELECT 1 FROM open_question WHERE workspace_id=$1 AND id=$2 AND current_version=$3",
          [w, c.questionId, c.questionVersion],
        )
      ).rowCount,
      "QUESTION_VERSION_STALE",
    );
  const workId = randomUUID(),
    sourceId = randomUUID();
  const sequence = (
    await tx.query(
      "UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message",
      [w],
    )
  ).rows[0].next_message;
  await tx.query(
    "INSERT INTO message(id,workspace_id,sequence,author_id,content) VALUES($1,$2,$3,$4,$5)",
    [sourceId, w, sequence, actor, c.query],
  );
  const goal = (
    await tx.query(
      "SELECT id,current_version FROM goal WHERE workspace_id=$1 AND current_primary",
      [w],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO research_work(id,workspace_id,requested_by,request_source_id,query,goal_id,goal_version,context_revision,access_revision,requester_membership_version,status,question_id,question_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12)",
    [
      workId,
      w,
      actor,
      sourceId,
      c.query,
      goal?.id ?? null,
      goal?.current_version ?? null,
      ws.context_revision,
      ws.access_revision,
      await membershipVersion(tx, w, actor),
      c.questionId ?? null,
      c.questionVersion ?? null,
    ],
  );
  await event(
    tx,
    w,
    workId,
    0,
    "queued",
    actor,
    "Explicit request; only the exact query may leave the Workspace. Research does not authorize external writes or canonical acceptance.",
  );
  await wakeup(tx, workId);
  return { workId };
}
export async function controlResearch(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: z.infer<typeof researchControlSchema>,
) {
  await member(tx, ws.id, actor, true, true);
  const row = (
    await tx.query(
      "SELECT * FROM research_work WHERE workspace_id=$1 AND id=$2",
      [ws.id, c.workId],
    )
  ).rows[0];
  requireThat(row, "WORK_NOT_FOUND", 404);
  // No member or access steward can silently redirect another person's exact request.
  requireThat(row.requested_by === actor, "WORK_REQUESTER_REQUIRED", 403);
  if (c.type === "research.cancel") {
    requireThat(
      ["queued", "running", "needs_configuration", "failed"].includes(
        row.status,
      ),
      "WORK_NOT_CANCELLABLE",
    );
    await tx.query(
      "UPDATE research_work SET status='cancelled',generation=generation+1,lease_until=NULL WHERE id=$1",
      [row.id],
    );
    await event(tx, ws.id, row.id, row.generation + 1, "cancelled", actor);
  } else {
    requireThat(
      ["failed", "needs_configuration"].includes(row.status),
      "WORK_NOT_RETRYABLE",
    );
    requireThat(
      row.context_revision === ws.context_revision &&
        row.access_revision === ws.access_revision &&
        row.requester_membership_version ===
          (await membershipVersion(tx, ws.id, actor)),
      "RESEARCH_STALE",
    );
    requireThat(row.generation < 5, "RESEARCH_RETRY_LIMIT");
    await tx.query(
      "UPDATE research_work SET status='queued',lease_until=NULL,error_code=NULL WHERE id=$1",
      [row.id],
    );
    await event(tx, ws.id, row.id, row.generation, "queued", actor);
    await wakeup(tx, row.id);
  }
  return {};
}

export async function processResearch(
  workId: string,
  suppliedProvider?: ResearchProvider,
) {
  z.uuid().parse(workId);
  const claim = await transaction(async (tx) => {
    const lookup = (
      await tx.query("SELECT workspace_id FROM research_work WHERE id=$1", [
        workId,
      ])
    ).rows[0];
    if (!lookup) return null;
    const ws = await lockWorkspace(tx, lookup.workspace_id);
    const row = (
      await tx.query("SELECT * FROM research_work WHERE id=$1", [workId])
    ).rows[0];
    if (row.status !== "queued") return null;
    let invalid = false;
    try {
      await member(tx, ws.id, row.requested_by, true, true);
    } catch (error) {
      if (error instanceof DomainError) invalid = true;
      else throw error;
    }
    if (
      invalid ||
      row.access_revision !== ws.access_revision ||
      row.context_revision !== ws.context_revision ||
      row.requester_membership_version !==
        (await membershipVersion(tx, ws.id, row.requested_by))
    ) {
      await tx.query(
        "UPDATE research_work SET status='stale',error_code='RESEARCH_STALE' WHERE id=$1",
        [workId],
      );
      await event(tx, ws.id, workId, row.generation, "stale");
      return null;
    }
    let provider: ResearchProvider;
    try {
      provider = suppliedProvider ?? configuredResearchProvider();
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await tx.query(
        "UPDATE research_work SET status='needs_configuration',error_code=$2 WHERE id=$1",
        [workId, error.code],
      );
      await event(
        tx,
        ws.id,
        workId,
        row.generation,
        "needs_configuration",
        null,
        error.code,
      );
      return null;
    }
    row.generation++;
    await tx.query(
      "UPDATE research_work SET status='running',generation=$2,lease_until=now()+interval '60 seconds',error_code=NULL WHERE id=$1",
      [workId, row.generation],
    );
    await tx.query(
      "INSERT INTO research_attempt(workspace_id,work_id,generation,provider,query) VALUES($1,$2,$3,$4,$5)",
      [ws.id, workId, row.generation, provider.name, row.query],
    );
    await event(tx, ws.id, workId, row.generation, "running");
    return { row, provider };
  });
  if (!claim) return;
  const { row, provider } = claim;
  try {
    // Exact authorized query only. No cookies, credentials, entire history or implicit model-expanded query.
    const results = researchResultsSchema.parse(
      await provider.search(row.query),
    );
    await transaction(async (tx) => {
      const ws = await lockWorkspace(tx, row.workspace_id);
      const current = (
        await tx.query(
          "SELECT status,generation,lease_until FROM research_work WHERE id=$1",
          [workId],
        )
      ).rows[0];
      if (current.status !== "running" || current.generation !== row.generation)
        return;
      let authorized = true;
      try {
        await member(tx, ws.id, row.requested_by, true, true);
        authorized =
          row.requester_membership_version ===
          (await membershipVersion(tx, ws.id, row.requested_by));
      } catch (error) {
        if (error instanceof DomainError) authorized = false;
        else throw error;
      }
      const stale =
        !authorized ||
        ws.context_revision !== row.context_revision ||
        ws.access_revision !== row.access_revision ||
        current.lease_until <= new Date();
      // Public search evidence may be kept as historical results when assumptions changed;
      // explicit cancellation or ended requester access prevents publication entirely.
      if (authorized)
        for (const result of results) {
          const sourceId = randomUUID();
          await tx.query(
            "INSERT INTO source_identity(id,workspace_id,kind) VALUES($1,$2,'web')",
            [sourceId, ws.id],
          );
          await tx.query(
            "INSERT INTO external_source(id,workspace_id,kind,title,content,contributed_by,qualification,content_hash,url,provider,work_id,work_generation) VALUES($1,$2,'web',$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [
              sourceId,
              ws.id,
              result.title,
              result.excerpt,
              row.requested_by,
              "Estratto restituito dal provider di ricerca; pagina non letta integralmente, informazione non verificata né accettata.",
              createHash("sha256").update(result.excerpt).digest("hex"),
              result.url,
              provider.name,
              workId,
              row.generation,
            ],
          );
          if (!stale) await scheduleSource(tx, ws.id, sourceId);
        }
      const status = stale ? "stale" : "completed";
      await tx.query(
        "UPDATE research_work SET status=$2,lease_until=NULL,error_code=$3 WHERE id=$1",
        [workId, status, stale ? "RESEARCH_STALE" : null],
      );
      await event(
        tx,
        ws.id,
        workId,
        row.generation,
        status,
        null,
        stale
          ? "Results are historical only; no automatic interpretation."
          : `${results.length} sources retrieved; not accepted information.`,
      );
    });
  } catch (error) {
    // Never persist/log provider payloads, query URLs with credentials or arbitrary exception messages.
    const code = error instanceof DomainError ? error.code : "RESEARCH_FAILED";
    await transaction(async (tx) => {
      await lockWorkspace(tx, row.workspace_id);
      const r = await tx.query(
        "UPDATE research_work SET status='failed',lease_until=NULL,error_code=$3 WHERE id=$1 AND generation=$2 AND status='running' RETURNING id",
        [workId, row.generation, code],
      );
      if (r.rowCount)
        await event(
          tx,
          row.workspace_id,
          workId,
          row.generation,
          "failed",
          null,
          code,
        );
    });
  }
}
export async function recoverResearch() {
  const expired = (
    await pool.query(
      "SELECT id,workspace_id FROM research_work WHERE status='running' AND lease_until<now()",
    )
  ).rows;
  for (const r of expired)
    await transaction(async (tx) => {
      await lockWorkspace(tx, r.workspace_id);
      const updated = await tx.query(
        "UPDATE research_work SET status='failed',lease_until=NULL,error_code='RESEARCH_INTERRUPTED' WHERE id=$1 AND status='running' AND lease_until<now() RETURNING generation",
        [r.id],
      );
      if (updated.rowCount)
        await event(
          tx,
          r.workspace_id,
          r.id,
          updated.rows[0].generation,
          "failed",
          null,
          "RESEARCH_INTERRUPTED",
        );
    });
}
