import { randomUUID } from "node:crypto";
import type {
  ArtifactBlock,
  ArtifactDocumentCommand,
} from "../contracts/artifact-document.ts";
import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { changed, member, type WorkspaceRow } from "./workspace-state.ts";

export function renderArtifactBlocks(blocks: ArtifactBlock[]) {
  return blocks
    .map((b) =>
      b.type === "paragraph"
        ? b.text
        : b.type === "heading"
          ? `## ${b.text}`
          : b.type === "checklist"
            ? b.items
                .map((i) => `- [${i.checked ? "x" : " "}] ${i.text}`)
                .join("\n")
            : b.type === "image"
              ? `Immagine: ${b.alt}\nFonte: ${b.sourceId}${b.caption ? `\n${b.caption}` : ""}`
              : [
                  b.columns.join(" | "),
                  ...b.rows.map((row) => row.join(" | ")),
                ].join("\n"),
    )
    .join("\n\n");
}
export async function composeArtifact(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: ArtifactDocumentCommand,
) {
  const w = ws.id;
  await member(tx, w, actor, true, true);
  let blocks: ArtifactBlock[],
    information: { id: string; version: number }[],
    sourceIds: string[],
    contributionId: string | null;
  let prior: { id: string; current_draft_version: number } | undefined;
  if (c.type === "artifact.compose") {
    requireThat(
      Boolean(c.artifactId) === Boolean(c.expectedVersion),
      "ARTIFACT_VERSION_REQUIRED",
    );
    if (c.artifactId) {
      prior = (
        await tx.query(
          "SELECT id,current_draft_version FROM artifact WHERE workspace_id=$1 AND id=$2",
          [w, c.artifactId],
        )
      ).rows[0];
      requireThat(prior, "ARTIFACT_NOT_FOUND", 404);
      requireThat(
        prior.current_draft_version === c.expectedVersion,
        "ARTIFACT_VERSION_STALE",
      );
    }
    blocks = c.blocks;
    information = c.information;
    sourceIds = [...c.sourceIds];
    contributionId =
      c.contributionId === undefined && prior
        ? ((
            await tx.query(
              "SELECT contribution_id FROM artifact_document WHERE workspace_id=$1 AND artifact_id=$2 AND artifact_version=$3",
              [w, prior.id, prior.current_draft_version],
            )
          ).rows[0]?.contribution_id ?? null)
        : (c.contributionId ?? null);
  } else {
    blocks = [];
    information = [];
    sourceIds = [];
    contributionId = c.contributionId;
  }
  let provider: string | null = null,
    model: string | null = null;
  if (contributionId) {
    const contribution = (
      await tx.query(
        "SELECT c.*,a.provider FROM active_work_contribution c JOIN active_work_attempt a ON (a.workspace_id,a.work_id,a.generation)=(c.workspace_id,c.work_id,c.generation) WHERE c.workspace_id=$1 AND c.id=$2",
        [w, contributionId],
      )
    ).rows[0];
    requireThat(contribution, "CONTRIBUTION_NOT_FOUND", 404);
    if (c.type === "artifact.from_contribution") {
      blocks = [
        { type: "paragraph", text: contribution.body },
        { type: "paragraph", text: contribution.qualification },
      ];
      const inputs = (
        await tx.query(
          "SELECT * FROM active_work_input WHERE workspace_id=$1 AND work_id=$2 AND generation=$3",
          [w, contribution.work_id, contribution.generation],
        )
      ).rows;
      information = inputs
        .filter((i) => i.kind === "information")
        .map((i) => ({ id: i.reference_id, version: i.reference_version }));
      sourceIds = inputs
        .filter((i) => i.kind === "source")
        .map((i) => i.reference_id);
    }
    provider = contribution.provider;
    model = null;
  }
  requireThat(
    new Set(information.map((i) => i.id)).size === information.length,
    "DUPLICATE_INFORMATION_SELECTION",
  );
  const support: string[] = [];
  for (const i of information) {
    const v = (
      await tx.query(
        "SELECT candidate_id FROM information_version WHERE workspace_id=$1 AND information_id=$2 AND version=$3",
        [w, i.id, i.version],
      )
    ).rows[0];
    requireThat(v, "INFORMATION_VERSION_NOT_FOUND", 404);
    support.push(
      ...(
        await tx.query<{ source_id: string }>(
          "SELECT source_id FROM candidate_source WHERE workspace_id=$1 AND candidate_id=$2",
          [w, v.candidate_id],
        )
      ).rows.map((s) => s.source_id),
    );
  }
  for (const block of blocks) {
    if (block.type === "table")
      requireThat(
        block.rows.every((row) => row.length === block.columns.length),
        "ARTIFACT_TABLE_SHAPE_INVALID",
        400,
      );
    if (block.type === "image") {
      requireThat(
        (
          await tx.query(
            "SELECT 1 FROM external_source WHERE workspace_id=$1 AND id=$2 AND media_type LIKE 'image/%'",
            [w, block.sourceId],
          )
        ).rowCount,
        "ARTIFACT_IMAGE_SOURCE_NOT_FOUND",
        404,
      );
      sourceIds.push(block.sourceId);
    }
  }
  const allSources = [...new Set([...sourceIds, ...support])];
  for (const id of allSources)
    requireThat(
      (
        await tx.query(
          "SELECT 1 FROM workspace_source WHERE workspace_id=$1 AND id=$2",
          [w, id],
        )
      ).rowCount,
      "SOURCE_NOT_FOUND",
      404,
    );
  const body = renderArtifactBlocks(blocks);
  requireThat(body.length <= 200000, "ARTIFACT_CONTENT_TOO_LARGE", 413);
  const id = prior?.id ?? randomUUID(),
    version = (prior?.current_draft_version ?? 0) + 1;
  if (prior)
    await tx.query(
      "UPDATE artifact SET current_draft_version=$3 WHERE workspace_id=$1 AND id=$2",
      [w, id, version],
    );
  else
    await tx.query(
      "INSERT INTO artifact(id,workspace_id,current_draft_version) VALUES($1,$2,$3)",
      [id, w, version],
    );
  const goal = (
    await tx.query(
      "SELECT id,current_version FROM goal WHERE workspace_id=$1 AND current_primary",
      [w],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO artifact_version(workspace_id,artifact_id,version,title,notes,body,authored_by,origin,generator,provider,model,goal_id,goal_version,context_revision,reason) VALUES($1,$2,$3,$4,$5,$6,$7,'human_revision',$8,$9,$10,$11,$12,$13,$14)",
    [
      w,
      id,
      version,
      c.title,
      c.purpose,
      body,
      actor,
      c.type === "artifact.from_contribution"
        ? "contribution_document_v1"
        : "structured_document_v1",
      provider,
      model,
      goal?.id ?? null,
      goal?.current_version ?? null,
      ws.context_revision,
      c.type === "artifact.compose"
        ? c.reason
        : "Explicit preparation from a Specialist Contribution; no adoption or normative effect",
    ],
  );
  await tx.query("INSERT INTO artifact_document VALUES($1,$2,$3,$4,$5,$6)", [
    w,
    id,
    version,
    c.purpose,
    JSON.stringify(blocks),
    contributionId,
  ]);
  for (const i of information)
    await tx.query("INSERT INTO artifact_information VALUES($1,$2,$3,$4,$5)", [
      w,
      id,
      version,
      i.id,
      i.version,
    ]);
  for (const source of allSources)
    await tx.query("INSERT INTO artifact_source VALUES($1,$2,$3,$4,$5)", [
      w,
      id,
      version,
      source,
      sourceIds.includes(source),
    ]);
  await tx.query(
    "INSERT INTO artifact_project_basis SELECT $1,$2,$3,id FROM current_project_act WHERE workspace_id=$1",
    [w, id, version],
  );
  await changed(tx, w, c.type);
  return { artifactId: id, version };
}
