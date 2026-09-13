import { projectViewSchema } from "../contracts/project.ts";
import { transaction } from "./db.ts";
import { member } from "./workspace-state.ts";
import { currentActIds, mandateAvailable } from "./project-authority.ts";

export async function projectView(actor: string, w: string) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const accessRevision = (
      await tx.query("SELECT access_revision FROM workspace WHERE id=$1", [w])
    ).rows[0].access_revision;
    const members = (
      await tx.query(
        'SELECT m.user_id AS id,u.name,m.active,(u.eligible AND u."emailVerified") AS eligible FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.name',
        [w],
      )
    ).rows;
    const rows = (
      await tx.query(
        "SELECT g.*,v.content FROM goal g JOIN goal_version v ON (v.workspace_id,v.goal_id,v.version)=(g.workspace_id,g.id,g.current_version) WHERE g.workspace_id=$1 ORDER BY g.current_primary DESC,g.id",
        [w],
      )
    ).rows;
    const goals = [];
    for (const g of rows) {
      const versions = (
        await tx.query(
          "SELECT * FROM goal_version WHERE workspace_id=$1 AND goal_id=$2 ORDER BY version DESC",
          [w, g.id],
        )
      ).rows.map((v) => ({
        version: v.version,
        content: v.content,
        actor: v.established_by,
        sourceId: v.source_id,
        reason: v.reason,
        createdAt: v.created_at.toISOString(),
      }));
      const participants = (
        await tx.query<{ person_id: string }>(
          "SELECT person_id FROM goal_intent_participant WHERE workspace_id=$1 AND goal_id=$2 AND goal_version=$3",
          [w, g.id, g.current_version],
        )
      ).rows.map((r) => r.person_id);
      const adherences = (
        await tx.query(
          'SELECT user_id AS "personId",goal_version AS version FROM goal_adherence WHERE workspace_id=$1 AND goal_id=$2 ORDER BY created_at',
          [w, g.id],
        )
      ).rows;
      goals.push({
        id: g.id,
        version: g.current_version,
        content: g.content,
        currentPrimary: g.current_primary,
        status: g.status,
        parentGoalId: g.parent_goal_id,
        parentGoalVersion: g.parent_goal_version,
        participants,
        adherences,
        versions,
      });
    }
    const goalProposals = [],
      acts = [],
      mandates = [];
    const current = await currentActIds(tx, w);
    for (const p of (
      await tx.query(
        "SELECT p.*,a.adopted_at FROM goal_transition p LEFT JOIN goal_transition_adoption a ON (a.workspace_id,a.transition_id)=(p.workspace_id,p.id) WHERE p.workspace_id=$1 ORDER BY p.created_at DESC",
        [w],
      )
    ).rows) {
      const people = (
        await tx.query<{ person_id: string }>(
          "SELECT person_id FROM goal_transition_person WHERE workspace_id=$1 AND transition_id=$2 ORDER BY person_id",
          [w, p.id],
        )
      ).rows.map((r) => r.person_id);
      const obligations = (
        await tx.query(
          'SELECT act_id AS "actId",blocking FROM goal_transition_obligation WHERE workspace_id=$1 AND transition_id=$2 ORDER BY act_id',
          [w, p.id],
        )
      ).rows;
      const approvals = (
        await tx.query(
          "SELECT * FROM goal_transition_approval WHERE workspace_id=$1 AND transition_id=$2 ORDER BY created_at",
          [w, p.id],
        )
      ).rows.map((a) => ({
        personId: a.person_id,
        actorId: a.actor_id,
        mandateId: a.mandate_id,
        mandateVersion: a.mandate_version,
        createdAt: a.created_at.toISOString(),
      }));
      const g = rows.find((g) => g.id === p.goal_id);
      const stale =
        !g ||
        g.current_version !== p.goal_version ||
        g.status !== p.base_status ||
        g.current_primary !== p.base_primary ||
        g.parent_goal_id !== p.base_parent_goal_id ||
        g.parent_goal_version !== p.base_parent_goal_version ||
        JSON.stringify(obligations.map((o) => o.actId)) !==
          JSON.stringify(current);
      goalProposals.push({
        id: p.id,
        goalId: p.goal_id,
        goalVersion: p.goal_version,
        mode: p.mode,
        content: p.content,
        reason: p.reason,
        actor: p.actor_id,
        sourceId: p.source_id,
        previousBecomesSubgoal: p.previous_becomes_subgoal,
        people,
        obligations,
        status: p.adopted_at
          ? "adopted"
          : stale
            ? "stale"
            : obligations.some((o) => o.blocking)
              ? "blocked"
              : "pending",
        approvals,
        createdAt: p.created_at.toISOString(),
      });
    }
    for (const m of (
      await tx.query(
        "SELECT v.* FROM project_mandate m JOIN project_mandate_version v ON (v.workspace_id,v.mandate_id,v.version)=(m.workspace_id,m.id,m.current_version) WHERE m.workspace_id=$1 ORDER BY v.created_at DESC",
        [w],
      )
    ).rows) {
      const versions = (
        await tx.query(
          "SELECT * FROM project_mandate_version WHERE workspace_id=$1 AND mandate_id=$2 ORDER BY version DESC",
          [w, m.mandate_id],
        )
      ).rows.map((v) => ({
        version: v.version,
        status: v.status,
        actor: v.actor_id,
        reason: v.reason,
        sourceId: v.source_id,
        createdAt: v.created_at.toISOString(),
      }));
      mandates.push({
        id: m.mandate_id,
        version: m.version,
        grantorId: m.grantor_id,
        holderId: m.holder_id,
        scope: { kind: m.scope_kind, id: m.scope_id, version: m.scope_version },
        capability: m.capability,
        status: m.status,
        expiresAt: m.expires_at?.toISOString() ?? null,
        available: await mandateAvailable(tx, w, m),
        reason: m.reason,
        sourceId: m.source_id,
        terms:
          "Rappresentanza della sola persona concedente, limitata a questo oggetto/versione e questa capability. Vale soltanto durante le stesse partecipazioni attive e idonee di concedente e destinatario; nessuna delega ulteriore o autorizzazione di effetti esterni. Contestare la propria rappresentanza sospende i nuovi usi senza cancellare gli atti precedenti.",
        versions,
      });
    }
    for (const p of (
      await tx.query(
        "SELECT p.*,a.id AS act_id FROM normative_proposal p LEFT JOIN project_act a ON (a.workspace_id,a.proposal_id)=(p.workspace_id,p.id) WHERE p.workspace_id=$1 ORDER BY p.created_at DESC",
        [w],
      )
    ).rows) {
      const people = (
        await tx.query<{ person_id: string }>(
          "SELECT person_id FROM required_project_approval WHERE workspace_id=$1 AND proposal_id=$2 ORDER BY person_id",
          [w, p.id],
        )
      ).rows.map((r) => r.person_id);
      const approvals = (
        await tx.query(
          "SELECT * FROM project_approval WHERE workspace_id=$1 AND proposal_id=$2 ORDER BY created_at",
          [w, p.id],
        )
      ).rows.map((a) => ({
        personId: a.person_id,
        actorId: a.actor_id ?? a.person_id,
        mandateId: a.mandate_id,
        mandateVersion: a.mandate_version,
        createdAt: a.created_at.toISOString(),
      }));
      acts.push({
        proposalId: p.id,
        actId: p.act_id,
        kind: p.kind,
        content: p.content,
        operation: p.operation,
        replacesActId: p.replaces_act_id,
        sourceId: p.source_id,
        candidateId: p.candidate_id,
        goalId: p.goal_id,
        goalVersion: p.goal_version,
        people,
        status: !p.act_id
          ? "proposed"
          : current.includes(p.act_id)
            ? "effective"
            : "superseded",
        approvals,
        createdAt: p.created_at.toISOString(),
      });
    }
    const relations = (
      await tx.query(
        'SELECT id,from_goal_id AS "fromGoalId",from_version AS "fromVersion",to_goal_id AS "toGoalId",to_version AS "toVersion",kind,transition_id AS "transitionId" FROM goal_relation WHERE workspace_id=$1 ORDER BY created_at',
        [w],
      )
    ).rows;
    return projectViewSchema.parse({
      accessRevision,
      members,
      goals,
      goalProposals,
      mandates,
      acts,
      relations,
    });
  });
}
