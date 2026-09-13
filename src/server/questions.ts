import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./db.ts";
import { changed, member, type WorkspaceRow } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";

import {
  questionOpenSchema,
  questionAnswerSchema,
  questionReopenSchema,
} from "../contracts/commands.ts";
export {
  questionOpenSchema,
  questionAnswerSchema,
  questionReopenSchema,
} from "../contracts/commands.ts";
type QuestionCommand =
  | z.infer<typeof questionOpenSchema>
  | z.infer<typeof questionAnswerSchema>
  | z.infer<typeof questionReopenSchema>;
export async function changeQuestion(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: QuestionCommand,
) {
  const w = ws.id;
  await member(tx, w, actor, true, true);
  if (c.type === "question.open") {
    requireThat(
      (
        await tx.query(
          "SELECT 1 FROM source_identity WHERE workspace_id=$1 AND id=$2",
          [w, c.sourceId],
        )
      ).rowCount,
      "SOURCE_NOT_FOUND",
      404,
    );
    if (c.candidateId) {
      const proposal = (
        await tx.query(
          "SELECT * FROM candidate WHERE workspace_id=$1 AND id=$2",
          [w, c.candidateId],
        )
      ).rows[0];
      requireThat(
        proposal &&
          proposal.source_id === c.sourceId &&
          proposal.content === c.content &&
          proposal.classification === "question",
        "QUESTION_PROPOSAL_MISMATCH",
      );
      requireThat(
        proposal.context_revision === ws.context_revision,
        "CANDIDATE_STALE",
      );
    }
    const questionId = randomUUID();
    await tx.query(
      "INSERT INTO open_question(id,workspace_id,current_version) VALUES($1,$2,1)",
      [questionId, w],
    );
    await tx.query(
      "INSERT INTO question_version(workspace_id,question_id,version,content,status,source_id,candidate_id,recorded_by,reason) VALUES($1,$2,1,$3,'open',$4,$5,$6,$7)",
      [
        w,
        questionId,
        c.content,
        c.sourceId,
        c.candidateId ?? null,
        actor,
        "Explicitly recorded question; no acceptance of premises, priority, assignment or commitment.",
      ],
    );
    await changed(tx, w, c.type, true);
    return { questionId, version: 1 };
  }
  const current = (
    await tx.query(
      "SELECT v.* FROM open_question q JOIN question_version v ON (v.workspace_id,v.question_id,v.version)=(q.workspace_id,q.id,q.current_version) WHERE q.workspace_id=$1 AND q.id=$2",
      [w, c.questionId],
    )
  ).rows[0];
  requireThat(current, "QUESTION_NOT_FOUND", 404);
  requireThat(current.version === c.expectedVersion, "QUESTION_VERSION_STALE");
  if (c.type === "question.answer") {
    requireThat(current.status === "open", "QUESTION_ALREADY_ANSWERED");
    const answer = (
      await tx.query(
        "SELECT current_version FROM accepted_information WHERE workspace_id=$1 AND id=$2",
        [w, c.informationId],
      )
    ).rows[0];
    requireThat(
      answer?.current_version === c.informationVersion,
      "INFORMATION_VERSION_STALE",
    );
  } else requireThat(current.status === "answered", "QUESTION_ALREADY_OPEN");
  const version = current.version + 1;
  await tx.query(
    "INSERT INTO question_version(workspace_id,question_id,version,content,status,source_id,candidate_id,recorded_by,reason,answer_information_id,answer_information_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      w,
      c.questionId,
      version,
      current.content,
      c.type === "question.answer" ? "answered" : "open",
      current.source_id,
      current.candidate_id,
      actor,
      c.reason,
      c.type === "question.answer" ? c.informationId : null,
      c.type === "question.answer" ? c.informationVersion : null,
    ],
  );
  await tx.query(
    "UPDATE open_question SET current_version=$3 WHERE workspace_id=$1 AND id=$2",
    [w, c.questionId, version],
  );
  await changed(tx, w, c.type, true);
  return { questionId: c.questionId, version };
}
