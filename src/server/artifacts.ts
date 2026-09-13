import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./db.ts";
import { changed, member, type WorkspaceRow } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";

import {
  artifactDraftSchema,
  artifactReviseSchema,
  artifactReviewSchema,
  artifactApproveSchema,
} from "../contracts/commands.ts";
export {
  artifactDraftSchema,
  artifactReviseSchema,
  artifactReviewSchema,
  artifactApproveSchema,
} from "../contracts/commands.ts";
type Draft =
  z.infer<typeof artifactDraftSchema> | z.infer<typeof artifactReviseSchema>;
import type { ArtifactVersion } from "../contracts/web-snapshot.ts";
async function currentGoal(tx: Tx, w: string) {
  return (
    await tx.query(
      "SELECT id,current_version FROM goal WHERE workspace_id=$1 AND current_primary",
      [w],
    )
  ).rows[0];
}

// Real deterministic compilation of selected references, not an AI/test fixture or an evidence adjudicator.
export async function draftArtifact(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: Draft,
) {
  const w = ws.id;
  await member(tx, w, actor, true, true);
  const q = (
    await tx.query(
      "SELECT v.* FROM open_question q JOIN question_version v ON (v.workspace_id,v.question_id,v.version)=(q.workspace_id,q.id,q.current_version) WHERE q.workspace_id=$1 AND q.id=$2 AND q.current_version=$3",
      [w, c.questionId, c.questionVersion],
    )
  ).rows[0];
  requireThat(q, "QUESTION_VERSION_STALE");
  requireThat(
    new Set(c.information.map((i) => i.id)).size === c.information.length,
    "DUPLICATE_INFORMATION_SELECTION",
  );
  const information = [];
  for (const item of c.information) {
    const row = (
      await tx.query(
        'SELECT a.subject,v.*,u.name AS accepted_by_name FROM accepted_information a JOIN information_version v ON (v.workspace_id,v.information_id,v.version)=(a.workspace_id,a.id,a.current_version) JOIN "user" u ON u.id=v.accepted_by WHERE a.workspace_id=$1 AND a.id=$2 AND a.current_version=$3',
        [w, item.id, item.version],
      )
    ).rows[0];
    requireThat(row, "INFORMATION_VERSION_STALE");
    information.push(row);
  }
  const selected = [...new Set(c.sourceIds)];
  const support = (
    await tx.query(
      "SELECT DISTINCT source_id FROM candidate_source WHERE workspace_id=$1 AND candidate_id=ANY($2::uuid[])",
      [w, information.map((i) => i.candidate_id)],
    )
  ).rows.map((r) => r.source_id as string);
  const ids = [...new Set([q.source_id, ...support, ...selected])];
  const sources = (
    await tx.query(
      "SELECT * FROM workspace_source WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY created_at,id",
      [w, ids],
    )
  ).rows;
  requireThat(sources.length === ids.length, "SOURCE_NOT_FOUND", 404);
  // Historical supporting sources stay inspectable; explicit source selections must still be current.
  for (const sourceId of selected)
    requireThat(
      !(
        await tx.query(
          "SELECT 1 FROM external_source s JOIN external_source newer ON newer.workspace_id=s.workspace_id AND newer.document_id=s.document_id AND newer.document_version>s.document_version WHERE s.workspace_id=$1 AND s.id=$2",
          [w, sourceId],
        )
      ).rowCount,
      "ARTIFACT_SOURCE_STALE",
    );
  let artifactId: string = randomUUID();
  let version = 1;
  if (c.type === "artifact.revise") {
    const a = (
      await tx.query(
        "SELECT current_draft_version FROM artifact WHERE workspace_id=$1 AND id=$2",
        [w, c.artifactId],
      )
    ).rows[0];
    requireThat(a, "ARTIFACT_NOT_FOUND", 404);
    requireThat(
      a.current_draft_version === c.expectedVersion,
      "ARTIFACT_VERSION_STALE",
    );
    artifactId = c.artifactId;
    version = c.expectedVersion + 1;
    await tx.query(
      "UPDATE artifact SET current_draft_version=$3 WHERE workspace_id=$1 AND id=$2",
      [w, artifactId, version],
    );
  } else
    await tx.query(
      "INSERT INTO artifact(id,workspace_id,current_draft_version) VALUES($1,$2,1)",
      [artifactId, w],
    );
  const goal = await currentGoal(tx, w);
  const body = [
    c.title,
    "BRIEF DI RICERCA — contenuto non operativo. Non stabilisce né modifica decisioni, vincoli, impegni o autorizzazioni.",
    `Domanda di riferimento (v${q.version}): ${q.content}`,
    "RIFERIMENTI ACCETTATI SELEZIONATI (non verità garantite)",
    ...information.map(
      (i, index) =>
        `[I${index + 1}] ${i.subject} · v${i.version}\n${i.content}\nQualificazione conservata: ${i.qualification}\nAccettazione attribuita a ${i.accepted_by_name}.`,
    ),
    "FONTI CONSERVATE — la selezione non ne accetta il contenuto",
    ...sources.map(
      (s, index) =>
        `[S${index + 1}] ${s.kind === "message" ? s.author_name : s.title}${s.document_version ? ` · v${s.document_version}` : ""}${s.url ? `\n${s.url}` : ""}\n${s.qualification ?? "Affermazione attribuita; non verificata automaticamente."}`,
    ),
    "NOTE / IPOTESI PROPOSTE DALL’AUTORE",
    c.notes || "Nessuna nota aggiunta.",
    "La raccolta riguarda i riferimenti selezionati. Non costituisce una verifica di completezza né una sintesi AI. Citazioni, ipotesi e suggerimenti non autorizzano azioni.",
  ].join("\n\n");
  await tx.query(
    "INSERT INTO artifact_version(workspace_id,artifact_id,version,title,notes,body,authored_by,origin,generator,question_id,question_version,goal_id,goal_version,context_revision,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    [
      w,
      artifactId,
      version,
      c.title,
      c.notes,
      body,
      actor,
      c.type === "artifact.draft" ? "reference_compilation" : "human_revision",
      "reference_brief_v1",
      c.questionId,
      c.questionVersion,
      goal?.id ?? null,
      goal?.current_version ?? null,
      ws.context_revision,
      c.type === "artifact.revise"
        ? c.reason
        : "Explicit preparation from selected reference versions; no adoption.",
    ],
  );
  for (const i of c.information)
    await tx.query("INSERT INTO artifact_information VALUES($1,$2,$3,$4,$5)", [
      w,
      artifactId,
      version,
      i.id,
      i.version,
    ]);
  for (const sourceId of ids)
    await tx.query("INSERT INTO artifact_source VALUES($1,$2,$3,$4,$5)", [
      w,
      artifactId,
      version,
      sourceId,
      selected.includes(sourceId),
    ]);
  await tx.query(
    "INSERT INTO artifact_project_basis SELECT $1,$2,$3,id FROM current_project_act WHERE workspace_id=$1",
    [w, artifactId, version],
  );
  await changed(tx, w, c.type);
  return { artifactId, version };
}

// Dependency checks deliberately avoid making every unrelated Workspace revision invalidate parallel preparation.
export async function artifactOutdatedReasons(
  tx: Tx,
  w: string,
  v: ArtifactVersion,
) {
  const reasons: string[] = [];
  const goal = await currentGoal(tx, w);
  if (
    (goal?.id ?? null) !== v.goal_id ||
    (goal?.current_version ?? null) !== v.goal_version
  )
    reasons.push("Goal cambiato");
  if (
    v.question_id &&
    !(
      await tx.query(
        "SELECT 1 FROM open_question WHERE workspace_id=$1 AND id=$2 AND current_version=$3",
        [w, v.question_id, v.question_version],
      )
    ).rowCount
  )
    reasons.push("Domanda cambiata");
  if (
    (
      await tx.query(
        "SELECT 1 FROM artifact_information i JOIN accepted_information a ON (a.workspace_id,a.id)=(i.workspace_id,i.information_id) WHERE i.workspace_id=$1 AND i.artifact_id=$2 AND i.artifact_version=$3 AND a.current_version<>i.information_version",
        [w, v.artifact_id, v.version],
      )
    ).rowCount
  )
    reasons.push("Informazione accettata aggiornata");
  if (
    (
      await tx.query(
        "SELECT 1 FROM artifact_source r JOIN external_source s ON (s.workspace_id,s.id)=(r.workspace_id,r.source_id) JOIN external_source newer ON newer.workspace_id=s.workspace_id AND newer.document_id=s.document_id AND newer.document_version>s.document_version WHERE r.workspace_id=$1 AND r.artifact_id=$2 AND r.artifact_version=$3 AND r.explicitly_selected",
        [w, v.artifact_id, v.version],
      )
    ).rowCount
  )
    reasons.push("Documento selezionato aggiornato");
  if (
    (
      await tx.query(
        "SELECT 1 FROM artifact_document d JOIN active_work_contribution c ON c.workspace_id=d.workspace_id AND c.id=d.contribution_id JOIN active_work w ON w.workspace_id=c.workspace_id AND w.id=c.work_id WHERE d.workspace_id=$1 AND d.artifact_id=$2 AND d.artifact_version=$3 AND (w.validity<>'current' OR w.contract_version<>c.contract_version OR w.phase<>'completed')",
        [w, v.artifact_id, v.version],
      )
    ).rowCount
  )
    reasons.push("Contribution non più corrente");
  const basis = (
    await tx.query(
      "SELECT act_id FROM artifact_project_basis WHERE workspace_id=$1 AND artifact_id=$2 AND artifact_version=$3 ORDER BY act_id",
      [w, v.artifact_id, v.version],
    )
  ).rows.map((r) => r.act_id);
  const acts = (
    await tx.query(
      "SELECT id FROM current_project_act WHERE workspace_id=$1 ORDER BY id",
      [w],
    )
  ).rows.map((r) => r.id);
  if (JSON.stringify(basis) !== JSON.stringify(acts))
    reasons.push("Stato degli impegni cambiato");
  return reasons;
}
async function validDraft(
  tx: Tx,
  w: string,
  artifactId: string,
  version: number,
) {
  const a = (
    await tx.query("SELECT * FROM artifact WHERE workspace_id=$1 AND id=$2", [
      w,
      artifactId,
    ])
  ).rows[0];
  requireThat(a, "ARTIFACT_NOT_FOUND", 404);
  requireThat(a.current_draft_version === version, "ARTIFACT_VERSION_STALE");
  const v = (
    await tx.query<ArtifactVersion>(
      "SELECT * FROM artifact_version WHERE workspace_id=$1 AND artifact_id=$2 AND version=$3",
      [w, artifactId, version],
    )
  ).rows[0];
  requireThat(
    !(await artifactOutdatedReasons(tx, w, v)).length,
    "ARTIFACT_BASIS_STALE",
  );
  return { a, v };
}
export async function reviewArtifact(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: z.infer<typeof artifactReviewSchema>,
) {
  const w = ws.id;
  await member(tx, w, actor, true, true);
  const { a } = await validDraft(tx, w, c.artifactId, c.version);
  const people = [...new Set(c.people)].sort();
  for (const p of people) await member(tx, w, p, true, true);
  if (a.current_adoption_id) {
    const previous = (
      await tx.query(
        "SELECT r.person_id FROM artifact_adoption a JOIN artifact_reviewer r ON r.workspace_id=a.workspace_id AND r.review_id=a.review_id WHERE a.workspace_id=$1 AND a.id=$2 ORDER BY r.person_id",
        [w, a.current_adoption_id],
      )
    ).rows.map((r) => r.person_id);
    // This slice supports revision within the already represented scope, not changing/removing others' representation.
    requireThat(
      JSON.stringify(previous) === JSON.stringify(people),
      "ARTIFACT_SCOPE_CHANGE_UNSUPPORTED",
    );
  }
  const reviewId = randomUUID();
  await tx.query(
    "INSERT INTO artifact_review(id,workspace_id,artifact_id,artifact_version,previous_adoption_id,proposed_by) VALUES($1,$2,$3,$4,$5,$6)",
    [reviewId, w, c.artifactId, c.version, a.current_adoption_id, actor],
  );
  for (const p of people)
    await tx.query("INSERT INTO artifact_reviewer VALUES($1,$2,$3)", [
      w,
      reviewId,
      p,
    ]);
  await changed(tx, w, c.type);
  return { reviewId };
}
export async function approveArtifact(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: z.infer<typeof artifactApproveSchema>,
) {
  const w = ws.id;
  await member(tx, w, actor, true, true);
  requireThat(
    ws.access_revision === c.expectedAccessRevision,
    "AUTHORITY_STALE",
  );
  const review = (
    await tx.query(
      "SELECT * FROM artifact_review WHERE workspace_id=$1 AND id=$2",
      [w, c.reviewId],
    )
  ).rows[0];
  requireThat(review, "ARTIFACT_REVIEW_NOT_FOUND", 404);
  const { a } = await validDraft(
    tx,
    w,
    review.artifact_id,
    review.artifact_version,
  );
  requireThat(
    a.current_adoption_id === review.previous_adoption_id,
    "ARTIFACT_REVIEW_STALE",
  );
  const people = (
    await tx.query<{ person_id: string }>(
      "SELECT person_id FROM artifact_reviewer WHERE workspace_id=$1 AND review_id=$2 ORDER BY person_id",
      [w, c.reviewId],
    )
  ).rows;
  requireThat(
    people.some((p) => p.person_id === actor),
    "NOT_A_NAMED_APPROVER",
    403,
  );
  for (const p of people) await member(tx, w, p.person_id, true, true);
  await tx.query(
    "INSERT INTO artifact_approval(id,workspace_id,review_id,person_id,membership_version,access_revision) SELECT $1,$2,$3,$4,version,$5 FROM membership WHERE workspace_id=$2 AND user_id=$4",
    [randomUUID(), w, c.reviewId, actor, ws.access_revision],
  );
  const approvals = (
    await tx.query(
      "SELECT DISTINCT ON(p.person_id) p.id,p.person_id FROM artifact_approval p JOIN membership m ON (m.workspace_id,m.user_id)=(p.workspace_id,p.person_id) WHERE p.workspace_id=$1 AND p.review_id=$2 AND p.access_revision=$3 AND m.active AND m.version=p.membership_version ORDER BY p.person_id,p.created_at DESC",
      [w, c.reviewId, ws.access_revision],
    )
  ).rows;
  let adoptionId: string | null = null;
  if (approvals.length === people.length) {
    adoptionId = randomUUID();
    await tx.query(
      "INSERT INTO artifact_adoption(id,workspace_id,artifact_id,review_id) VALUES($1,$2,$3,$4)",
      [adoptionId, w, review.artifact_id, c.reviewId],
    );
    for (const p of approvals)
      await tx.query(
        "INSERT INTO artifact_adoption_approval VALUES($1,$2,$3)",
        [w, adoptionId, p.id],
      );
    await tx.query(
      "UPDATE artifact SET current_adoption_id=$3 WHERE workspace_id=$1 AND id=$2",
      [w, review.artifact_id, adoptionId],
    );
  }
  await changed(tx, w, c.type, Boolean(adoptionId));
  return { adopted: Boolean(adoptionId), adoptionId };
}
export async function readArtifacts(tx: Tx, w: string) {
  const artifacts = (
    await tx.query<{
      id: string;
      current_draft_version: number;
      current_adoption_id: string | null;
    }>(
      "SELECT id,current_draft_version,current_adoption_id FROM artifact WHERE workspace_id=$1 ORDER BY id",
      [w],
    )
  ).rows;
  const versions = (
    await tx.query<ArtifactVersion>(
      "SELECT v.*,d.purpose,d.blocks,d.contribution_id FROM artifact_version v LEFT JOIN artifact_document d ON (d.workspace_id,d.artifact_id,d.artifact_version)=(v.workspace_id,v.artifact_id,v.version) WHERE v.workspace_id=$1 ORDER BY v.artifact_id,v.version",
      [w],
    )
  ).rows;
  const artifactVersions = [];
  for (const v of versions)
    artifactVersions.push({
      ...v,
      outdated_reasons: await artifactOutdatedReasons(tx, w, v),
    });
  const artifactReviews = (
    await tx.query<{
      id: string;
      artifact_id: string;
      artifact_version: number;
      previous_adoption_id: string | null;
      proposed_by: string;
      people: string[];
      created_at: string;
    }>(
      "SELECT r.*,ARRAY(SELECT person_id FROM artifact_reviewer p WHERE p.workspace_id=r.workspace_id AND p.review_id=r.id ORDER BY person_id) AS people FROM artifact_review r WHERE r.workspace_id=$1 ORDER BY r.created_at",
      [w],
    )
  ).rows;
  const artifactApprovals = (
    await tx.query<{
      id: string;
      review_id: string;
      person_id: string;
      access_revision: number;
      created_at: string;
    }>(
      "SELECT id,review_id,person_id,access_revision,created_at FROM artifact_approval WHERE workspace_id=$1 ORDER BY created_at",
      [w],
    )
  ).rows;
  const artifactAdoptions = (
    await tx.query<{
      id: string;
      artifact_id: string;
      review_id: string;
      created_at: string;
    }>(
      "SELECT id,artifact_id,review_id,created_at FROM artifact_adoption WHERE workspace_id=$1 ORDER BY created_at",
      [w],
    )
  ).rows;
  const artifactInformation = (
    await tx.query<{
      artifact_id: string;
      artifact_version: number;
      information_id: string;
      information_version: number;
    }>(
      "SELECT artifact_id,artifact_version,information_id,information_version FROM artifact_information WHERE workspace_id=$1",
      [w],
    )
  ).rows;
  const artifactSources = (
    await tx.query<{
      artifact_id: string;
      artifact_version: number;
      source_id: string;
      explicitly_selected: boolean;
    }>(
      "SELECT artifact_id,artifact_version,source_id,explicitly_selected FROM artifact_source WHERE workspace_id=$1",
      [w],
    )
  ).rows;
  return {
    artifacts,
    artifactVersions,
    artifactReviews,
    artifactApprovals,
    artifactAdoptions,
    artifactInformation,
    artifactSources,
  };
}
export type ArtifactSnapshot = Awaited<ReturnType<typeof readArtifacts>>;
