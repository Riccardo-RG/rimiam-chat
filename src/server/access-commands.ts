import { randomUUID } from "node:crypto";
import type { AccessCommand } from "../contracts/access.ts";
import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import {
  authenticatedSession,
  changed,
  member,
  type WorkspaceRow,
} from "./workspace-state.ts";

export interface AccessRelationship {
  id: string;
  workspace_id: string;
  holder_id: string;
  version: number;
  active: boolean;
  invitations: boolean;
  remove_members: boolean;
  change_access: boolean;
  protected: boolean;
  kind: "stewardship" | "invitation_delegate";
  basis: string;
}
interface Target {
  relationship_id: string;
  holder_id: string;
  base_version: number;
  active: boolean;
  kind: "stewardship" | "invitation_delegate";
  protected: boolean;
}
export async function accessConditions(
  tx: Tx,
  w: string,
  relation: AccessRelationship,
) {
  const versioned = await tx.query(
    "SELECT version FROM access_version_terms WHERE workspace_id=$1 AND relationship_id=$2 AND version<=$3 ORDER BY version DESC LIMIT 1",
    [w, relation.id, relation.version],
  );
  const rows = await tx.query<{ id: string }>(
    versioned.rowCount
      ? "SELECT required_participation_id AS id FROM access_version_condition WHERE workspace_id=$1 AND relationship_id=$2 AND version=$3 ORDER BY required_participation_id"
      : "SELECT required_participation_id AS id FROM access_condition WHERE workspace_id=$1 AND relationship_id=$2 AND $3::int>0 ORDER BY required_participation_id",
    [w, relation.id, versioned.rows[0]?.version ?? relation.version],
  );
  // Legacy bootstrap has no conditions; its current relationship is its authority basis.
  if (!rows.rowCount && !relation.protected && relation.kind === "stewardship")
    return [relation.id];
  return rows.rows.map((r) => r.id);
}
export async function participationAvailable(tx: Tx, w: string, id: string) {
  return !!(
    await tx.query(
      `SELECT 1 FROM access_relationship r JOIN membership m ON (m.workspace_id,m.user_id)=(r.workspace_id,r.holder_id)
     JOIN "user" u ON u.id=m.user_id LEFT JOIN access_version_terms t ON (t.workspace_id,t.relationship_id,t.version)=(r.workspace_id,r.id,r.version)
     WHERE r.workspace_id=$1 AND r.id=$2 AND r.active AND m.active AND u.eligible AND u."emailVerified"
     AND (t.membership_version IS NULL OR t.membership_version=m.version)`,
      [w, id],
    )
  ).rowCount;
}
async function currentSteward(tx: Tx, w: string, actor: string) {
  const row = (
    await tx.query<AccessRelationship>(
      "SELECT * FROM access_relationship WHERE workspace_id=$1 AND holder_id=$2 AND active AND change_access AND kind='stewardship'",
      [w, actor],
    )
  ).rows[0];
  requireThat(
    row && (await participationAvailable(tx, w, row.id)),
    "ACCESS_CHANGE_AUTHORITY_REQUIRED",
    403,
  );
  return row;
}
async function history(
  tx: Tx,
  w: string,
  relation: string,
  actor: string,
  proposal: string,
) {
  await tx.query(
    `INSERT INTO access_history(id,workspace_id,relationship_id,version,active,invitations,remove_members,change_access,protected,actor_id,basis)
     SELECT $1,workspace_id,id,version,active,invitations,remove_members,change_access,protected,$4,$5 FROM access_relationship WHERE workspace_id=$2 AND id=$3`,
    [randomUUID(), w, relation, actor, `access_proposal:${proposal}`],
  );
}
export async function applyAccess(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: AccessCommand,
  sessionId?: string,
) {
  const w = ws.id;
  await authenticatedSession(tx, actor, sessionId);
  await member(tx, w, actor, false, true);
  requireThat(
    ws.access_revision === c.expectedAccessRevision,
    "AUTHORITY_STALE",
  );
  if (c.type === "access.propose") {
    const authority = await currentSteward(tx, w, actor);
    const existing = (
      await tx.query<AccessRelationship>(
        "SELECT * FROM access_relationship WHERE workspace_id=$1 AND active ORDER BY id",
        [w],
      )
    ).rows;
    const targets: Target[] = [];
    const governing = new Set<string>();
    const holders = new Set<string>();
    if (c.change.kind === "stewardship") {
      const people = [...new Set(c.change.people)].sort();
      requireThat(
        people.length === c.change.people.length,
        "DUPLICATE_STEWARD",
      );
      const stewards = existing.filter((r) => r.kind === "stewardship");
      // All powers conflicting with the explicitly chosen arrangement are replaced together.
      for (const r of stewards) {
        const conditions = await accessConditions(tx, w, r);
        requireThat(conditions.length, "ACCESS_CONDITIONS_UNAVAILABLE", 403);
        for (const id of conditions) governing.add(id);
        if (!people.includes(r.holder_id))
          targets.push({
            relationship_id: r.id,
            holder_id: r.holder_id,
            base_version: r.version,
            active: false,
            kind: r.kind,
            protected: r.protected,
          });
      }
      for (const person of people) {
        await member(tx, w, person, false, true);
        const prior = existing.find((r) => r.holder_id === person);
        targets.push({
          relationship_id: prior?.id ?? randomUUID(),
          holder_id: person,
          base_version: prior?.version ?? 0,
          active: true,
          kind: "stewardship",
          protected: people.length > 1,
        });
        holders.add(person);
      }
    } else if (c.change.kind === "delegation") {
      const personId = c.change.personId;
      await member(tx, w, c.change.personId, false, true);
      requireThat(
        !existing.some((r) => r.holder_id === personId),
        "ACCESS_RELATIONSHIP_ALREADY_ACTIVE",
      );
      targets.push({
        relationship_id: randomUUID(),
        holder_id: c.change.personId,
        base_version: 0,
        active: true,
        kind: "invitation_delegate",
        protected: false,
      });
      governing.add(authority.id);
      holders.add(c.change.personId);
    } else {
      const relationshipId = c.change.relationshipId;
      const relation = existing.find((r) => r.id === relationshipId);
      requireThat(relation, "ACCESS_RELATIONSHIP_NOT_FOUND", 404);
      requireThat(
        relation.kind === "invitation_delegate" && !relation.protected,
        "PROTECTED_CHANGE_REQUIRES_ARRANGEMENT",
        403,
      );
      // Delegates explicitly accept revocation by current valid stewards, not merely their original grantor.
      targets.push({
        relationship_id: relation.id,
        holder_id: relation.holder_id,
        base_version: relation.version,
        active: false,
        kind: relation.kind,
        protected: false,
      });
      governing.add(authority.id);
    }
    const proposalId = randomUUID();
    await tx.query(
      "INSERT INTO access_proposal(id,workspace_id,kind,base_access_revision,proposed_by,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [proposalId, w, c.change.kind, ws.access_revision, actor, c.reason],
    );
    for (const target of targets)
      await tx.query(
        "INSERT INTO access_proposal_target VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          w,
          proposalId,
          target.relationship_id,
          target.holder_id,
          target.base_version,
          target.active,
          target.kind,
          target.protected,
        ],
      );
    for (const participation of governing) {
      const r = existing.find((r) => r.id === participation);
      requireThat(
        r?.kind === "stewardship" &&
          r.change_access &&
          (await participationAvailable(tx, w, participation)),
        "ACCESS_CONDITIONS_UNAVAILABLE",
        403,
      );
      await tx.query(
        "INSERT INTO access_proposal_requirement VALUES($1,$2,'authority',$3,$4)",
        [w, proposalId, r.holder_id, participation],
      );
    }
    requireThat(governing.size, "ACCESS_CHANGE_AUTHORITY_REQUIRED", 403);
    for (const person of holders)
      await tx.query(
        "INSERT INTO access_proposal_requirement VALUES($1,$2,'holder',$3,NULL)",
        [w, proposalId, person],
      );
    await changed(tx, w, c.type);
    return { proposalId, adopted: false };
  }
  const p = (
    await tx.query(
      "SELECT * FROM access_proposal WHERE workspace_id=$1 AND id=$2",
      [w, c.proposalId],
    )
  ).rows[0];
  requireThat(p, "ACCESS_PROPOSAL_NOT_FOUND", 404);
  requireThat(
    p.base_access_revision === ws.access_revision,
    "ACCESS_PROPOSAL_STALE",
  );
  requireThat(
    !(
      await tx.query(
        "SELECT 1 FROM access_proposal_adoption WHERE workspace_id=$1 AND proposal_id=$2",
        [w, p.id],
      )
    ).rowCount,
    "ACCESS_PROPOSAL_ALREADY_ADOPTED",
  );
  const required = (
    await tx.query(
      "SELECT * FROM access_proposal_requirement WHERE workspace_id=$1 AND proposal_id=$2",
      [w, p.id],
    )
  ).rows;
  const own = required.find((r) => r.person_id === actor && r.role === c.role);
  requireThat(own, "NOT_AN_ACCESS_APPROVER", 403);
  if (own.role === "authority")
    requireThat(
      await participationAvailable(tx, w, own.participation_id),
      "ACCESS_CONDITIONS_UNAVAILABLE",
      403,
    );
  const membership = (
    await tx.query(
      "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2 AND active",
      [w, actor],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO access_proposal_approval(id,workspace_id,proposal_id,role,person_id,session_id,membership_version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,proposal_id,role,person_id) DO NOTHING",
    [randomUUID(), w, p.id, c.role, actor, sessionId, membership.version],
  );
  const approvals = (
    await tx.query(
      "SELECT * FROM access_proposal_approval WHERE workspace_id=$1 AND proposal_id=$2",
      [w, p.id],
    )
  ).rows;
  let adopted = false;
  if (approvals.length === required.length) {
    // Validate all pre-transition authority and current holder eligibility before changing any relationship.
    for (const req of required) {
      await member(tx, w, req.person_id, false, true);
      const approval = approvals.find(
        (a) => a.role === req.role && a.person_id === req.person_id,
      )!;
      requireThat(
        (
          await tx.query(
            "SELECT 1 FROM membership WHERE workspace_id=$1 AND user_id=$2 AND version=$3 AND active",
            [w, req.person_id, approval.membership_version],
          )
        ).rowCount,
        "ACCESS_APPROVAL_STALE",
      );
      if (req.role === "authority")
        requireThat(
          await participationAvailable(tx, w, req.participation_id),
          "ACCESS_CONDITIONS_UNAVAILABLE",
          403,
        );
    }
    const targets = (
      await tx.query<Target>(
        "SELECT * FROM access_proposal_target WHERE workspace_id=$1 AND proposal_id=$2 ORDER BY active,relationship_id",
        [w, p.id],
      )
    ).rows;
    const joint = targets
      .filter((t) => t.active && t.kind === "stewardship")
      .map((t) => t.relationship_id);
    for (const t of targets) {
      if (t.base_version > 0) {
        const changedRow = await tx.query(
          "UPDATE access_relationship SET version=version+1,active=$4,invitations=$4,remove_members=$5,change_access=$5,protected=$6,kind=$7,basis=$8 WHERE workspace_id=$1 AND id=$2 AND version=$3 AND active RETURNING id",
          [
            w,
            t.relationship_id,
            t.base_version,
            t.active,
            t.active && t.kind === "stewardship",
            t.protected,
            t.kind,
            `access_proposal:${p.id}`,
          ],
        );
        requireThat(changedRow.rowCount, "ACCESS_RELATIONSHIP_STALE");
      } else
        await tx.query(
          "INSERT INTO access_relationship(id,workspace_id,holder_id,invitations,remove_members,change_access,protected,kind,basis) VALUES($1,$2,$3,true,$4,$4,$5,$6,$7)",
          [
            t.relationship_id,
            w,
            t.holder_id,
            t.kind === "stewardship",
            t.protected,
            t.kind,
            `access_proposal:${p.id}`,
          ],
        );
      await history(tx, w, t.relationship_id, actor, p.id);
      await tx.query(
        "INSERT INTO access_version_terms SELECT $1,$2,$3,$4,version,$5 FROM membership WHERE workspace_id=$1 AND user_id=$6",
        [w, t.relationship_id, t.base_version + 1, t.kind, p.id, t.holder_id],
      );
    }
    // New participation identities now exist; conditions refer to identities, never future people.
    for (const t of targets.filter((t) => t.active && t.kind === "stewardship"))
      for (const participation of joint)
        await tx.query(
          "INSERT INTO access_version_condition VALUES($1,$2,$3,$4)",
          [w, t.relationship_id, t.base_version + 1, participation],
        );
    await tx.query(
      "INSERT INTO access_proposal_adoption(workspace_id,proposal_id) VALUES($1,$2)",
      [w, p.id],
    );
    adopted = true;
  }
  await changed(tx, w, c.type, false, adopted);
  return { proposalId: p.id as string, adopted };
}
