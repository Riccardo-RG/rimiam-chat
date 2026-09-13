import { randomUUID } from "node:crypto";
import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { member } from "./workspace-state.ts";

export async function projectSource(
  tx: Tx,
  w: string,
  actor: string,
  content: string,
) {
  const id = randomUUID();
  requireThat(content.length <= 12000, "PROJECT_SOURCE_TOO_LONG", 400);
  const seq = (
    await tx.query(
      "UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message",
      [w],
    )
  ).rows[0].next_message;
  await tx.query(
    "INSERT INTO message(id,workspace_id,sequence,author_id,content) VALUES($1,$2,$3,$4,$5)",
    [id, w, seq, actor, content],
  );
  return id;
}
export async function mandateAt(tx: Tx, w: string, id: string) {
  const row = (
    await tx.query(
      "SELECT v.* FROM project_mandate m JOIN project_mandate_version v ON (v.workspace_id,v.mandate_id,v.version)=(m.workspace_id,m.id,m.current_version) WHERE m.workspace_id=$1 AND m.id=$2",
      [w, id],
    )
  ).rows[0];
  requireThat(row, "MANDATE_NOT_FOUND", 404);
  return row;
}
export async function mandateAvailable(
  tx: Tx,
  w: string,
  m: Record<string, unknown>,
) {
  if (
    m.status !== "accepted" ||
    (m.expires_at && new Date(String(m.expires_at)) <= new Date())
  )
    return false;
  for (const role of ["grantor", "holder"]) {
    const ok = (
      await tx.query(
        'SELECT 1 FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.version=$3 AND m.active AND u.eligible AND u."emailVerified"',
        [w, m[`${role}_id`], m[`${role}_membership_version`]],
      )
    ).rowCount;
    if (!ok) return false;
  }
  return true;
}
export async function projectAuthority(
  tx: Tx,
  w: string,
  actor: string,
  person: string,
  scopeKind: "goal" | "act",
  scopeId: string,
  scopeVersion: number,
  capability: string,
  mandateId?: string,
) {
  await member(tx, w, actor, true, true);
  if (actor === person && !mandateId) return null;
  requireThat(mandateId, "PERTINENT_MANDATE_REQUIRED", 403);
  const m = await mandateAt(tx, w, mandateId);
  requireThat(
    m.grantor_id === person &&
      m.holder_id === actor &&
      m.scope_kind === scopeKind &&
      m.scope_id === scopeId &&
      m.scope_version === scopeVersion &&
      m.capability === capability &&
      (await mandateAvailable(tx, w, m)),
    "MANDATE_NOT_APPLICABLE",
    403,
  );
  return m;
}
export async function currentActIds(tx: Tx, w: string) {
  return (
    await tx.query<{ id: string }>(
      "SELECT id FROM current_project_act WHERE workspace_id=$1 ORDER BY id",
      [w],
    )
  ).rows.map((r) => r.id);
}
export async function goalAt(tx: Tx, w: string, id: string) {
  const g = (
    await tx.query(
      "SELECT g.*,v.content,v.established_by FROM goal g JOIN goal_version v ON (v.workspace_id,v.goal_id,v.version)=(g.workspace_id,g.id,g.current_version) WHERE g.workspace_id=$1 AND g.id=$2",
      [w, id],
    )
  ).rows[0];
  requireThat(g, "GOAL_NOT_FOUND", 404);
  return g;
}
