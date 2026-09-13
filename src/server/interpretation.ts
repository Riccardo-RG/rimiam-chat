import { randomUUID } from "node:crypto";
import { collaborationMode as currentCollaborationMode } from "./participation.ts";
import { directlyAddressesMiriam } from "../shared/miriam-address.ts";
import { z } from "zod";
import { pool, transaction } from "./db.ts";
import { changed, lockWorkspace, enqueue } from "./workspace-state.ts";
import { DomainError, requireThat } from "./errors.ts";
import { calendarContext } from "./calendar-state.ts";
import { workContext } from "./tasks-context.ts";
import { miriamSystemPrompt } from "./miriam-prompt.ts";
import { sharedWorkAvailable } from "./active-work-context.ts";
import { organizeSources } from "./attention.ts";
import { workControlSchema } from "../contracts/active-work.ts";
import { createActiveWork } from "./active-work-commands.ts";
import {
  goalContext,
  activeWorkContext,
  artifactContext,
} from "./conversation-context.ts";
import {
  configuredStructuredModel,
  parseStructuredOutput,
} from "./structured-llm.ts";

const contextRounds = z.coerce
  .number()
  .int()
  .positive()
  .default(4)
  .parse(process.env.AI_CONTEXT_ROUNDS);
const leaseSeconds = Math.max(300, contextRounds * 45 + 30);

const proposalSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(12000),
  classification: z.enum(["descriptive", "normative", "uncertain", "question"]),
  origin: z.enum(["attributed", "inferred"]),
  qualification: z.string().max(4000),
  sourceIds: z.array(z.uuid()).min(1),
});
export const interpretationOutputSchema = z.object({
  proposals: z.array(proposalSchema).max(12),
  needsMore: z.array(z.string().min(1).max(120)).max(8),
  response: z
    .object({
      mode: z.enum(["observe", "respond"]),
      text: z.string().max(12000),
      sourceIds: z.array(z.uuid()).max(100),
    })
    .strict()
    .optional(),
  organization: z
    .array(
      z
        .object({
          title: z.string().trim().min(1).max(160),
          sourceIds: z.array(z.uuid()).min(1).max(100),
        })
        .strict(),
    )
    .max(4)
    .optional(),
  workControl: workControlSchema.nullable().optional(),
  workIntent: z
    .object({ objective: z.string().trim().min(3).max(4000) })
    .strict()
    .nullable()
    .optional(),
});
const outputSchema = interpretationOutputSchema;
export interface Source {
  id: string;
  content: string;
  author_id: string;
  sequence: number | null;
  kind?: "message" | "document" | "web";
  author_name?: string;
  qualification?: string;
  title?: string | null;
  url?: string | null;
  document_id?: string | null;
  document_version?: number | null;
  content_hash?: string | null;
}
export interface InterpretationContext {
  trigger: Source;
  sources: Source[];
  goal: unknown[];
  information: unknown[];
  commitments: unknown[];
  otherAccounts: unknown[];
  questions?: unknown[];
  temporal?: unknown[];
  work?: unknown[];
  workSelection?: { exhaustive: false; expandWithNeedsMore: true };
  conversation?: unknown[];
  workstreams?: unknown[];
  activeWork?: unknown[];
  artifacts?: unknown[];
  collaborationMode?: string;
  services?: {
    research: boolean;
    externalActions: "explicit_capability_approval_required";
  };
}
export interface Interpreter {
  interpret(
    context: InterpretationContext,
  ): Promise<z.infer<typeof outputSchema>>;
}
export function configuredInterpreter(): Interpreter {
  const structuredModel = configuredStructuredModel();
  if (!structuredModel) {
    return {
      async interpret() {
        throw new DomainError("AI_CONFIGURATION_REQUIRED", 503);
      },
    };
  }
  return {
    async interpret(context) {
      return structuredModel.generateJSON({
        system: miriamSystemPrompt,
        prompt: JSON.stringify(context),
        schema: outputSchema,
        maxOutputTokens: 4500,
      });
    },
  };
}
export async function claimInterpretation(interpretationId: string) {
  return transaction(async (tx) => {
    const lookup = await tx.query(
      "SELECT workspace_id FROM interpretation WHERE id=$1",
      [interpretationId],
    );
    if (!lookup.rowCount) return null;
    const w = lookup.rows[0].workspace_id;
    const ws = await lockWorkspace(tx, w);
    // One short claim serializes conversational continuity, not Active Work computation.
    if (
      (
        await tx.query(
          "SELECT 1 FROM interpretation WHERE workspace_id=$1 AND id<>$2 AND status='running' AND lease_until>now()",
          [w, interpretationId],
        )
      ).rowCount
    )
      return null;
    // A later queued message must not overtake an earlier queued conversational turn.
    const earlier = (
      await tx.query(
        "SELECT q.id FROM interpretation q JOIN interpretation target ON target.id=$2 WHERE q.workspace_id=$1 AND q.status='queued' AND (q.created_at,q.id)<(target.created_at,target.id) ORDER BY q.created_at,q.id LIMIT 1",
        [w, interpretationId],
      )
    ).rows[0];
    if (earlier) {
      await enqueue(tx, earlier.id);
      return null;
    }
    const r = await tx.query(
      "UPDATE interpretation SET status='running',generation=generation+1,context_revision=$2,access_revision=$3,lease_until=now()+$4*interval '1 second',error_code=NULL WHERE id=$1 AND (status IN ('queued','failed') OR (status='running' AND lease_until<now())) RETURNING *",
      [interpretationId, ws.context_revision, ws.access_revision, leaseSeconds],
    );
    if (!r.rowCount) return null;
    const attempt = r.rows[0];
    const trigger = (
      await tx.query<Source>(
        "SELECT * FROM workspace_source WHERE workspace_id=$1 AND id=$2",
        [w, attempt.source_id],
      )
    ).rows[0];
    const voice = (
      await tx.query(
        "SELECT mode FROM voice_message WHERE workspace_id=$1 AND source_id=$2",
        [w, attempt.source_id],
      )
    ).rows[0];
    if (voice?.mode === "miriam")
      trigger.qualification =
        (trigger.qualification ?? "") +
        " L'autore ha esplicitamente indirizzato questo messaggio vocale a Miriam: rispondi come a una domanda diretta, senza inventare autorizzazioni.";
    const goal = await goalContext(tx, w);
    const information = (
      await tx.query(
        "SELECT a.id,a.subject,v.* FROM accepted_information a JOIN information_version v ON (v.workspace_id,v.information_id,v.version)=(a.workspace_id,a.id,a.current_version) WHERE a.workspace_id=$1",
        [w],
      )
    ).rows;
    const commitments = (
      await tx.query(
        "SELECT p.*,ARRAY(SELECT person_id FROM required_project_approval r WHERE r.workspace_id=p.workspace_id AND r.proposal_id=p.id) AS represented FROM current_project_act a JOIN normative_proposal p ON (p.workspace_id,p.id)=(a.workspace_id,a.proposal_id) WHERE a.workspace_id=$1",
        [w],
      )
    ).rows;
    const questions = (
      await tx.query(
        "SELECT q.id,v.* FROM open_question q JOIN question_version v ON (v.workspace_id,v.question_id,v.version)=(q.workspace_id,q.id,q.current_version) WHERE q.workspace_id=$1",
        [w],
      )
    ).rows;
    // Current internal timing is canonical, with explicit actor/version provenance. External
    // observations and connection credentials are deliberately outside this shared projection.
    const temporal = await calendarContext(tx, w);
    const work = await workContext(
      tx,
      w,
      [
        ...new Set(
          trigger.content.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [],
        ),
      ],
      true,
    );
    const otherAccounts = (
      await tx.query(
        "SELECT c.id,c.subject,c.content,c.qualification,c.origin,c.source_id FROM candidate c WHERE c.workspace_id=$1 AND c.subject IN (SELECT subject FROM accepted_information WHERE workspace_id=$1) AND NOT EXISTS(SELECT 1 FROM information_version v WHERE v.workspace_id=c.workspace_id AND v.candidate_id=c.id) ORDER BY c.created_at",
        [w],
      )
    ).rows;
    // Alternative accounts stay unaccepted; preserve qualifications and exact sources in context.
    const sources = (
      await tx.query<Source>(
        "SELECT DISTINCT m.* FROM workspace_source m WHERE m.workspace_id=$1 AND (m.id=$2 OR m.id IN (SELECT v.source_id FROM open_question q JOIN question_version v ON (v.workspace_id,v.question_id,v.version)=(q.workspace_id,q.id,q.current_version) WHERE q.workspace_id=$1) OR m.id IN (SELECT cs.source_id FROM candidate_source cs JOIN information_version v ON v.workspace_id=cs.workspace_id AND v.candidate_id=cs.candidate_id JOIN accepted_information a ON a.workspace_id=v.workspace_id AND a.id=v.information_id AND a.current_version=v.version WHERE cs.workspace_id=$1)) ORDER BY m.created_at,m.id",
        [w, trigger.id],
      )
    ).rows;
    const related = (
      await tx.query<Source>(
        "SELECT DISTINCT m.* FROM workspace_source m JOIN candidate_source cs ON (cs.workspace_id,cs.source_id)=(m.workspace_id,m.id) WHERE m.workspace_id=$1 AND (cs.candidate_id=ANY($2::uuid[]) OR cs.candidate_id IN (SELECT p.candidate_id FROM current_project_act a JOIN normative_proposal p ON (p.workspace_id,p.id)=(a.workspace_id,a.proposal_id) WHERE a.workspace_id=$1)) ORDER BY m.created_at,m.id",
        [w, otherAccounts.map((a) => a.id)],
      )
    ).rows;
    const directActSources = (
      await tx.query<Source>(
        "SELECT DISTINCT s.* FROM workspace_source s JOIN normative_proposal p ON (p.workspace_id,p.source_id)=(s.workspace_id,s.id) JOIN current_project_act a ON (a.workspace_id,a.proposal_id)=(p.workspace_id,p.id) WHERE s.workspace_id=$1",
        [w],
      )
    ).rows;
    const allSources = [
      ...new Map(
        [...sources, ...related, ...directActSources].map((s) => [s.id, s]),
      ).values(),
    ];
    const conversation = (
      await tx.query(
        `SELECT COALESCE(voice.source_id,m.id) AS id,COALESCE(extracted.content,m.content) AS content,m.actor_kind,COALESCE(u.name,'Miriam') AS author_name,m.sequence
       FROM message m LEFT JOIN "user" u ON u.id=m.author_id
       LEFT JOIN voice_message voice ON voice.message_id=m.id
       LEFT JOIN document_extraction extracted ON extracted.source_id=voice.source_id AND extracted.publication='published' 
       WHERE m.workspace_id=$1 AND (m.created_at<=(SELECT created_at FROM workspace_source WHERE workspace_id=$1 AND id=$2)
         OR (m.actor_kind='miriam' AND EXISTS(SELECT 1 FROM workspace_source replied JOIN workspace_source trigger ON trigger.workspace_id=replied.workspace_id AND trigger.id=$2 WHERE replied.workspace_id=m.workspace_id AND replied.id=m.reply_to_source_id AND replied.created_at<=trigger.created_at)))
       ORDER BY m.sequence DESC LIMIT 16`,
        [w, trigger.id],
      )
    ).rows.reverse();
    // Recent messages are a starting window only; needsMore searches the entire retained history.
    const neighbours = (
      await tx.query<Source>(
        "SELECT * FROM workspace_source WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
        [
          w,
          conversation.filter((m) => m.actor_kind === "human").map((m) => m.id),
        ],
      )
    ).rows;
    const activeWork = await activeWorkContext(tx, w);
    const artifacts = await artifactContext(tx, w);
    const selectedSourceIds = [
      ...goal.map((g) => g.source_id),
      ...artifacts.flatMap((a) => a.source_ids),
      ...activeWork.flatMap(
        (a) =>
          a.contribution?.inputs
            ?.filter((i: { kind: string }) => i.kind === "source")
            .map((i: { id: string }) => i.id) ?? [],
      ),
    ].filter(Boolean);
    const referenceSources = (
      await tx.query<Source>(
        "SELECT * FROM workspace_source WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
        [w, selectedSourceIds],
      )
    ).rows;
    const workstreams = (
      await tx.query(
        "SELECT w.id,v.title,v.description FROM workstream w JOIN workstream_version v ON (v.workspace_id,v.workstream_id,v.version)=(w.workspace_id,w.id,w.current_version) WHERE w.workspace_id=$1 ORDER BY v.title",
        [w],
      )
    ).rows;
    const collaborationMode = await currentCollaborationMode(tx, w);
    return {
      attempt,
      context: {
        trigger,
        sources: [
          ...new Map(
            [...allSources, ...neighbours, ...referenceSources].map((s) => [
              s.id,
              s,
            ]),
          ).values(),
        ],
        goal,
        information,
        commitments,
        otherAccounts,
        questions,
        temporal,
        work,
        workSelection: { exhaustive: false, expandWithNeedsMore: true },
        conversation,
        workstreams,
        activeWork,
        artifacts,
        collaborationMode,
        services: {
          research: Boolean(
            process.env.RESEARCH_PROVIDER === "brave" &&
            process.env.BRAVE_SEARCH_API_KEY,
          ),
          externalActions: "explicit_capability_approval_required",
        },
      } satisfies InterpretationContext,
    };
  });
}
export async function retrieveSources(
  workspaceId: string,
  terms: string[],
): Promise<Source[]> {
  // Search all retained history within this Workspace, including pre-membership messages.
  // No recency window or fixed history/token cutoff is a correctness boundary.
  if (!terms.length) return [];
  return (
    await pool.query<Source>(
      "SELECT * FROM workspace_source WHERE workspace_id=$1 AND EXISTS(SELECT 1 FROM unnest($2::text[]) term WHERE to_tsvector('simple',content) @@ plainto_tsquery('simple',term) OR content ILIKE '%' || term || '%') ORDER BY created_at,id",
      [workspaceId, terms],
    )
  ).rows;
}
export async function publishInterpretation(
  claim: NonNullable<Awaited<ReturnType<typeof claimInterpretation>>>,
  output: unknown,
) {
  const parsed = parseStructuredOutput(outputSchema, output);
  requireThat(parsed.needsMore.length === 0, "MORE_CONTEXT_REQUIRED");
  const sources = new Set(claim.context.sources.map((s) => s.id));
  if (parsed.workControl) {
    const control = parsed.workControl;
    requireThat(
      claim.context.activeWork.some(
        (a) =>
          a.id === control.workId &&
          a.revision === control.expectedRevision &&
          a.current_contract,
      ),
      "WORK_CONTROL_NOT_PROVIDED",
    );
    if (control.operation === "format")
      requireThat(
        ["elenco", "sintesi", "dettagli"].includes(control.text.toLowerCase()),
        "WORK_CONTROL_FORMAT_INVALID",
      );
  }
  for (const group of parsed.organization ?? [])
    requireThat(
      group.sourceIds.every((id) => sources.has(id)),
      "SOURCE_NOT_PROVIDED",
    );
  if (parsed.response) {
    requireThat(
      parsed.response.sourceIds.every((s) => sources.has(s)),
      "INVALID_SOURCE_REFERENCE",
    );
    requireThat(
      parsed.response.mode === "respond"
        ? parsed.response.text.trim().length > 0
        : parsed.response.text.length === 0,
      "INVALID_RESPONSE_MODE",
    );
  }
  for (const proposal of parsed.proposals) {
    requireThat(
      proposal.sourceIds.every((s) => sources.has(s)),
      "INVALID_SOURCE_REFERENCE",
    );
    requireThat(
      proposal.sourceIds.includes(claim.context.trigger.id),
      "TRIGGER_SOURCE_REQUIRED",
    );
  }
  return transaction(async (tx) => {
    const { attempt } = claim;
    const ws = await lockWorkspace(tx, attempt.workspace_id);
    const row = (
      await tx.query("SELECT * FROM interpretation WHERE id=$1 FOR UPDATE", [
        attempt.id,
      ])
    ).rows[0];
    if (row.generation !== attempt.generation || row.status !== "running")
      return false;
    if (
      ws.context_revision !== attempt.context_revision ||
      ws.access_revision !== attempt.access_revision ||
      new Date(row.lease_until) <= new Date()
    ) {
      await tx.query(
        "UPDATE interpretation SET status='stale',lease_until=NULL WHERE id=$1",
        [attempt.id],
      );
      await changed(tx, ws.id, "interpretation.stale");
      return false;
    }
    requireThat(
      await sharedWorkAvailable(tx, ws.id),
      "WORK_CAPABILITY_UNAVAILABLE",
      403,
    );
    if (parsed.workControl) {
      const control = parsed.workControl;
      const work = (
        await tx.query(
          "SELECT revision FROM active_work WHERE workspace_id=$1 AND id=$2",
          [ws.id, control.workId],
        )
      ).rows[0];
      requireThat(
        work?.revision === control.expectedRevision,
        "WORK_STATE_STALE",
      );
      await tx.query(
        "INSERT INTO work_control_suggestion(id,workspace_id,work_id,expected_revision,operation,content,source_id,interpretation_id,generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          ws.id,
          control.workId,
          control.expectedRevision,
          control.operation,
          control.text,
          attempt.source_id,
          attempt.id,
          attempt.generation,
        ],
      );
      await changed(tx, ws.id, "work.control_proposed");
    }
    for (const p of parsed.proposals) {
      const candidateId = randomUUID();
      await tx.query(
        "INSERT INTO candidate(id,workspace_id,interpretation_id,source_id,subject,content,classification,origin,qualification,context_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          candidateId,
          ws.id,
          attempt.id,
          attempt.source_id,
          p.subject,
          p.content,
          p.classification,
          p.origin,
          [
            ...new Set([
              ...claim.context.sources
                .filter((s) => p.sourceIds.includes(s.id) && s.qualification)
                .map((s) => s.qualification!),
              p.qualification,
            ]),
          ].join("\n"),
          ws.context_revision,
        ],
      );
      for (const sourceId of [...new Set(p.sourceIds)])
        await tx.query(
          "INSERT INTO candidate_source(workspace_id,candidate_id,source_id) VALUES($1,$2,$3)",
          [ws.id, candidateId, sourceId],
        );
    }
    const explicitVoice =
      (
        await tx.query(
          "SELECT 1 FROM voice_message WHERE workspace_id=$1 AND source_id=$2 AND mode='miriam'",
          [ws.id, claim.context.trigger.id],
        )
      ).rowCount === 1;
    const mayIntervene =
      explicitVoice ||
      directlyAddressesMiriam(claim.context.trigger.content) ||
      (await currentCollaborationMode(tx, ws.id)) !== "discreet";
    if (parsed.response?.mode === "respond" && mayIntervene) {
      const messageId = randomUUID();
      const sequence = (
        await tx.query(
          "UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message",
          [ws.id],
        )
      ).rows[0].next_message;
      await tx.query(
        "INSERT INTO message(id,workspace_id,sequence,author_id,actor_kind,content,reply_to_source_id) VALUES($1,$2,$3,NULL,'miriam',$4,$5)",
        [
          messageId,
          ws.id,
          sequence,
          parsed.response.text.trim(),
          attempt.source_id,
        ],
      );
      await tx.query(
        "INSERT INTO miriam_response(workspace_id,message_id,interpretation_id,generation,source_ids) VALUES($1,$2,$3,$4,$5)",
        [
          ws.id,
          messageId,
          attempt.id,
          attempt.generation,
          [...new Set(parsed.response.sourceIds)],
        ],
      );
      await changed(tx, ws.id, "miriam.responded");
    }
    await organizeSources(
      tx,
      ws.id,
      attempt.source_id,
      parsed.organization ?? [],
    );
    if (parsed.workIntent && mayIntervene) {
      // Reversible shared analysis initiative belongs to Miriam, not borrowed human permissions.
      // A bounded attention guard skips optional initiative without losing the actual response.
      const count = (
        await tx.query(
          "SELECT count(*)::int AS n FROM active_work WHERE workspace_id=$1 AND phase IN ('queued','working')",
          [ws.id],
        )
      ).rows[0].n;
      if (count < 4)
        await createActiveWork(
          tx,
          ws.id,
          parsed.workIntent.objective,
          attempt.source_id,
          null,
        );
    }
    await tx.query(
      "UPDATE interpretation SET status='completed',lease_until=NULL WHERE id=$1",
      [attempt.id],
    );
    await changed(tx, ws.id, "interpretation.completed");
    const next = (
      await tx.query(
        "SELECT id FROM interpretation WHERE workspace_id=$1 AND status='queued' ORDER BY created_at,id LIMIT 1",
        [ws.id],
      )
    ).rows[0];
    if (next) await enqueue(tx, next.id);
    return true;
  });
}
export async function processInterpretation(
  interpretationId: string,
  interpreter: Interpreter = configuredInterpreter(),
) {
  const claim = await claimInterpretation(interpretationId);
  if (!claim) return;
  try {
    for (let round = 0; round < contextRounds; round++) {
      // Validate current shared capability immediately before each external disclosure.
      await transaction(async (tx) => {
        const ws = await lockWorkspace(tx, claim.attempt.workspace_id);
        const currentAttempt = (
          await tx.query(
            "SELECT generation,status,lease_until FROM interpretation WHERE id=$1",
            [claim.attempt.id],
          )
        ).rows[0];
        requireThat(
          currentAttempt?.generation === claim.attempt.generation &&
            currentAttempt.status === "running" &&
            new Date(currentAttempt.lease_until) > new Date(),
          "INTERPRETATION_LEASE_ENDED",
        );
        requireThat(
          ws.access_revision === claim.attempt.access_revision &&
            (await sharedWorkAvailable(tx, ws.id)),
          "WORK_CAPABILITY_UNAVAILABLE",
          403,
        );
        await tx.query(
          "INSERT INTO interpretation_input(workspace_id,interpretation_id,generation,round,context) VALUES($1,$2,$3,$4,$5)",
          [
            ws.id,
            claim.attempt.id,
            claim.attempt.generation,
            round + 1,
            JSON.stringify(claim.context),
          ],
        );
      });
      const output = parseStructuredOutput(
        outputSchema,
        await interpreter.interpret(claim.context),
      );
      await pool.query(
        "INSERT INTO interpretation_result(workspace_id,interpretation_id,generation,round,output) VALUES($1,$2,$3,$4,$5)",
        [
          claim.attempt.workspace_id,
          claim.attempt.id,
          claim.attempt.generation,
          round + 1,
          JSON.stringify(output),
        ],
      );
      if (!output.needsMore.length) {
        await publishInterpretation(claim, output);
        return;
      }
      const additional = await retrieveSources(
        claim.attempt.workspace_id,
        output.needsMore,
      );
      const byId = new Map(claim.context.sources.map((s) => [s.id, s]));
      for (const source of additional) byId.set(source.id, source);
      claim.context.sources = [...byId.values()];
      const additionalWork = await transaction((tx) =>
        workContext(tx, claim.attempt.workspace_id, output.needsMore),
      );
      const work = new Map(
        claim.context.work.map((t) => [`${t.id}:${t.version}`, t]),
      );
      for (const t of additionalWork) work.set(`${t.id}:${t.version}`, t);
      claim.context.work = [...work.values()];
      const additionalTemporal = await transaction((tx) =>
        calendarContext(tx, claim.attempt.workspace_id, output.needsMore),
      );
      const timing = new Map(
        claim.context.temporal.map((t) => [
          `${t.kind}:${t.id}:${t.version}`,
          t,
        ]),
      );
      for (const t of additionalTemporal)
        timing.set(`${t.kind}:${t.id}:${t.version}`, t);
      claim.context.temporal = [...timing.values()];
      const expanded = await transaction(async (tx) => ({
        goal: await goalContext(
          tx,
          claim.attempt.workspace_id,
          output.needsMore,
        ),
        activeWork: await activeWorkContext(
          tx,
          claim.attempt.workspace_id,
          output.needsMore,
        ),
        artifacts: await artifactContext(
          tx,
          claim.attempt.workspace_id,
          output.needsMore,
        ),
      }));
      for (const key of ["goal", "activeWork", "artifacts"] as const) {
        const rows = new Map(
          (claim.context[key] ?? []).map((r) => [
            `${r.goal_id ?? r.id}:${r.selected_contract_version ?? r.version}`,
            r,
          ]),
        );
        for (const r of expanded[key])
          rows.set(
            `${r.goal_id ?? r.id}:${r.selected_contract_version ?? r.version}`,
            r,
          );
        claim.context[key] = [...rows.values()];
      }
      const selectedSourceIds = [
        ...expanded.goal.map((g) => g.source_id),
        ...expanded.artifacts.flatMap((a) => a.source_ids),
        ...expanded.activeWork.flatMap(
          (a) =>
            a.contribution?.inputs
              ?.filter((i: { kind: string }) => i.kind === "source")
              .map((i: { id: string }) => i.id) ?? [],
        ),
      ].filter(Boolean);
      const referenceSources = (
        await pool.query<Source>(
          "SELECT * FROM workspace_source WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
          [claim.attempt.workspace_id, selectedSourceIds],
        )
      ).rows;
      const completeSources = new Map(
        claim.context.sources.map((s) => [s.id, s]),
      );
      for (const source of referenceSources)
        completeSources.set(source.id, source);
      claim.context.sources = [...completeSources.values()];
    }
    // Operational call budget defers the inference; it never promotes an insufficient answer.
    throw new DomainError("MORE_CONTEXT_REQUIRED");
  } catch (error) {
    const code =
      error instanceof DomainError ? error.code : "INTERPRETATION_FAILED";
    await transaction(async (tx) => {
      await lockWorkspace(tx, claim.attempt.workspace_id);
      const failed = await tx.query(
        "UPDATE interpretation SET status='failed',error_code=$3,lease_until=NULL WHERE id=$1 AND generation=$2 AND status='running'",
        [interpretationId, claim.attempt.generation, code],
      );
      if (failed.rowCount)
        await changed(tx, claim.attempt.workspace_id, "interpretation.failed");
    });
    // Delivery logs must not serialize provider responses or raw model output.
    throw new Error(code);
  }
}
export async function recoverExpiredInterpretations() {
  const expired = (
    await pool.query<{ id: string; workspace_id: string }>(
      "SELECT id,workspace_id FROM interpretation WHERE status='running' AND lease_until<now()",
    )
  ).rows;
  for (const item of expired)
    await transaction(async (tx) => {
      await lockWorkspace(tx, item.workspace_id);
      const r = await tx.query(
        "UPDATE interpretation SET status='queued',generation=generation+1,lease_until=NULL WHERE id=$1 AND status='running' AND lease_until<now() RETURNING id",
        [item.id],
      );
      if (r.rowCount) {
        await enqueue(tx, item.id);
        await changed(tx, item.workspace_id, "interpretation.recovered");
      }
    });
  const queued = (
    await pool.query<{ id: string; workspace_id: string }>(
      "SELECT DISTINCT ON (workspace_id) id,workspace_id FROM interpretation WHERE status='queued' ORDER BY workspace_id,created_at,id",
    )
  ).rows;
  for (const item of queued) await transaction((tx) => enqueue(tx, item.id));
}
