import { randomUUID } from "node:crypto";
import type { ProjectCommand } from "../contracts/project.ts";
import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import {
  authenticatedSession,
  changed,
  member,
  type WorkspaceRow,
} from "./workspace-state.ts";
import {
  currentActIds,
  goalAt,
  mandateAt,
  projectAuthority,
  projectSource,
} from "./project-authority.ts";

const capabilityForGoal = (mode: string) =>
  mode === "subgoal"
    ? "goal.subgoal"
    : ["complete", "abandon"].includes(mode)
      ? "goal.conclude"
      : "goal.change";

export async function applyProject(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: ProjectCommand,
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const w = ws.id;
  await authenticatedSession(tx, actor, sessionId);
  await member(tx, w, actor, true, true);
  if (c.type === "mandate.offer") {
    requireThat(c.holderId !== actor, "SELF_MANDATE_NOT_NEEDED");
    await member(tx, w, c.holderId, true, true);
    requireThat(
      !c.expiresAt || new Date(c.expiresAt) > new Date(),
      "MANDATE_ALREADY_EXPIRED",
    );
    if (c.scope.kind === "goal") {
      const g = await goalAt(tx, w, c.scope.id);
      requireThat(
        g.current_version === c.scope.version && g.status === "active",
        "GOAL_VERSION_STALE",
      );
      requireThat(
        ["goal.change", "goal.conclude", "goal.subgoal", "act.create"].includes(
          c.capability,
        ),
        "MANDATE_SCOPE_CAPABILITY_MISMATCH",
      );
    } else {
      requireThat(
        c.scope.version === 1 &&
          (
            await tx.query(
              "SELECT 1 FROM current_project_act WHERE workspace_id=$1 AND id=$2",
              [w, c.scope.id],
            )
          ).rowCount,
        "PROJECT_ACT_NOT_CURRENT",
      );
      requireThat(
        ["act.replace", "act.revoke"].includes(c.capability),
        "MANDATE_SCOPE_CAPABILITY_MISMATCH",
      );
    }
    const memberships = (
      await tx.query(
        "SELECT user_id,version FROM membership WHERE workspace_id=$1 AND user_id=ANY($2::text[])",
        [w, [actor, c.holderId]],
      )
    ).rows;
    const id = randomUUID(),
      source = await projectSource(
        tx,
        w,
        actor,
        `Propongo una delega della sola mia rappresentanza: ${c.capability}. ${c.reason}`,
      );
    await tx.query("INSERT INTO project_mandate VALUES($1,$2,1)", [id, w]);
    await tx.query(
      "INSERT INTO project_mandate_version(workspace_id,mandate_id,version,grantor_id,holder_id,grantor_membership_version,holder_membership_version,scope_kind,scope_id,scope_version,capability,status,expires_at,actor_id,reason,source_id) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,'offered',$11,$3,$12,$13)",
      [
        w,
        id,
        actor,
        c.holderId,
        memberships.find((m) => m.user_id === actor)!.version,
        memberships.find((m) => m.user_id === c.holderId)!.version,
        c.scope.kind,
        c.scope.id,
        c.scope.version,
        c.capability,
        c.expiresAt,
        c.reason,
        source,
      ],
    );
    await changed(tx, w, c.type, true);
    return { mandateId: id, version: 1 };
  }
  if (c.type === "mandate.respond") {
    const m = await mandateAt(tx, w, c.mandateId);
    requireThat(m.version === c.expectedVersion, "MANDATE_VERSION_STALE");
    const allowed: Record<
      string,
      { actor: string; status: string[]; next: string }
    > = {
      accept: { actor: m.holder_id, status: ["offered"], next: "accepted" },
      decline: { actor: m.holder_id, status: ["offered"], next: "declined" },
      contest: { actor: m.grantor_id, status: ["accepted"], next: "contested" },
      confirm: { actor: m.grantor_id, status: ["contested"], next: "accepted" },
      revoke: {
        actor: m.grantor_id,
        status: ["offered", "accepted", "contested"],
        next: "revoked",
      },
      relinquish: {
        actor: m.holder_id,
        status: ["offered", "accepted", "contested"],
        next: "relinquished",
      },
    };
    const rule = allowed[c.response];
    requireThat(
      rule.actor === actor && rule.status.includes(m.status),
      "MANDATE_RESPONSE_NOT_ALLOWED",
      403,
    );
    if (rule.next === "accepted") {
      for (const role of ["grantor", "holder"]) {
        await member(tx, w, m[`${role}_id`], true, true);
        requireThat(
          (
            await tx.query(
              "SELECT 1 FROM membership WHERE workspace_id=$1 AND user_id=$2 AND version=$3 AND active",
              [w, m[`${role}_id`], m[`${role}_membership_version`]],
            )
          ).rowCount,
          "MANDATE_PARTICIPATION_ENDED",
        );
      }
      requireThat(
        !m.expires_at || new Date(m.expires_at) > new Date(),
        "MANDATE_ALREADY_EXPIRED",
      );
    }
    const next = m.version + 1,
      source = await projectSource(
        tx,
        w,
        actor,
        `${c.response}: delega ${m.mandate_id}. ${c.reason}`,
      );
    await tx.query(
      "INSERT INTO project_mandate_version(workspace_id,mandate_id,version,grantor_id,holder_id,grantor_membership_version,holder_membership_version,scope_kind,scope_id,scope_version,capability,status,expires_at,actor_id,reason,source_id) SELECT workspace_id,mandate_id,$3,grantor_id,holder_id,grantor_membership_version,holder_membership_version,scope_kind,scope_id,scope_version,capability,$4,expires_at,$5,$6,$7 FROM project_mandate_version WHERE workspace_id=$1 AND mandate_id=$2 AND version=$8",
      [w, m.mandate_id, next, rule.next, actor, c.reason, source, m.version],
    );
    await tx.query(
      "UPDATE project_mandate SET current_version=$3 WHERE workspace_id=$1 AND id=$2",
      [w, m.mandate_id, next],
    );
    await changed(tx, w, c.type, true);
    return { mandateId: m.mandate_id, version: next };
  }
  if (c.type === "goal.propose") {
    const g = await goalAt(tx, w, c.goalId);
    requireThat(g.current_version === c.expectedVersion, "GOAL_VERSION_STALE");
    requireThat(
      g.status === "active" || c.mode === "replace",
      "GOAL_NOT_ACTIVE",
    );
    if (c.mode === "complete" || c.mode === "abandon")
      requireThat(
        c.content === g.content,
        "GOAL_CONTENT_CHANGE_REQUIRES_REVISION",
      );
    requireThat(
      c.mode === "replace" || !c.previousBecomesSubgoal,
      "INVALID_GOAL_ROLE_CHANGE",
    );
    if (c.mode === "replace")
      requireThat(
        g.current_primary ||
          !(
            await tx.query(
              "SELECT 1 FROM goal WHERE workspace_id=$1 AND current_primary",
              [w],
            )
          ).rowCount,
        "REPLACEMENT_REQUIRES_PRIMARY_GOAL",
      );
    const people = new Set<string>(
      (
        await tx.query<{ person_id: string }>(
          "SELECT person_id FROM goal_intent_participant WHERE workspace_id=$1 AND goal_id=$2 AND goal_version=$3 UNION SELECT user_id AS person_id FROM goal_adherence WHERE workspace_id=$1 AND goal_id=$2 AND goal_version=$3",
          [w, g.id, g.current_version],
        )
      ).rows.map((r) => r.person_id),
    );
    if (!people.size) people.add(g.established_by);
    for (const person of c.affectedPeople) {
      requireThat(
        (
          await tx.query(
            "SELECT 1 FROM membership WHERE workspace_id=$1 AND user_id=$2",
            [w, person],
          )
        ).rowCount,
        "PROJECT_PERSON_NOT_FOUND",
        404,
      );
      people.add(person);
    }
    const acts = await currentActIds(tx, w);
    requireThat(
      c.blockingActIds.every((id) => acts.includes(id)),
      "PROJECT_ACT_NOT_CURRENT",
    );
    const id = randomUUID(),
      source = await projectSource(tx, w, actor, c.content);
    await tx.query(
      "INSERT INTO goal_transition(id,workspace_id,goal_id,goal_version,mode,content,reason,previous_becomes_subgoal,actor_id,source_id,base_status,base_primary,base_parent_goal_id,base_parent_goal_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        id,
        w,
        g.id,
        g.current_version,
        c.mode,
        c.content,
        c.reason,
        c.previousBecomesSubgoal,
        actor,
        source,
        g.status,
        g.current_primary,
        g.parent_goal_id,
        g.parent_goal_version,
      ],
    );
    for (const person of people)
      await tx.query("INSERT INTO goal_transition_person VALUES($1,$2,$3)", [
        w,
        id,
        person,
      ]);
    for (const act of acts)
      await tx.query(
        "INSERT INTO goal_transition_obligation VALUES($1,$2,$3,$4)",
        [w, id, act, c.blockingActIds.includes(act)],
      );
    await changed(tx, w, c.type);
    return { transitionId: id };
  }
  if (c.type === "goal.approve") return approveGoal(tx, ws, actor, c);
  if (c.type === "project.propose") {
    if (c.goal) {
      const g = await goalAt(tx, w, c.goal.id);
      requireThat(
        g.current_version === c.goal.version && g.status === "active",
        "GOAL_VERSION_STALE",
      );
    }
    requireThat(
      (c.operation === "establish") === !c.replacesActId,
      "PROJECT_OPERATION_TARGET_REQUIRED",
    );
    if (c.operation === "revoke")
      requireThat(c.kind === "decision", "REVOCATION_IS_DECISION");
    const people = new Set(c.people);
    if (c.replacesActId) {
      const previous = (
        await tx.query(
          "SELECT a.*,p.kind FROM current_project_act a JOIN normative_proposal p ON (p.workspace_id,p.id)=(a.workspace_id,a.proposal_id) WHERE a.workspace_id=$1 AND a.id=$2",
          [w, c.replacesActId],
        )
      ).rows[0];
      requireThat(previous, "PROJECT_ACT_NOT_CURRENT");
      const original = (
        await tx.query<{ person_id: string }>(
          "SELECT person_id FROM required_project_approval WHERE workspace_id=$1 AND proposal_id=$2",
          [w, previous.proposal_id],
        )
      ).rows;
      for (const r of original) people.add(r.person_id);
    }
    for (const person of people)
      requireThat(
        (
          await tx.query(
            "SELECT 1 FROM membership WHERE workspace_id=$1 AND user_id=$2",
            [w, person],
          )
        ).rowCount,
        "PROJECT_PERSON_NOT_FOUND",
        404,
      );
    const id = randomUUID(),
      source = await projectSource(tx, w, actor, c.content);
    await tx.query(
      "INSERT INTO normative_proposal(id,workspace_id,content,kind,proposed_by,goal_id,goal_version,context_revision,source_id,operation,replaces_act_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        id,
        w,
        c.content,
        c.kind,
        actor,
        c.goal?.id ?? null,
        c.goal?.version ?? null,
        ws.context_revision,
        source,
        c.operation,
        c.replacesActId ?? null,
      ],
    );
    for (const person of people)
      await tx.query("INSERT INTO required_project_approval VALUES($1,$2,$3)", [
        w,
        id,
        person,
      ]);
    await changed(tx, w, c.type);
    return { proposalId: id };
  }
  return approveProject(tx, ws, actor, c);
}

async function approveGoal(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: Extract<ProjectCommand, { type: "goal.approve" }>,
) {
  const w = ws.id;
  requireThat(
    ws.access_revision === c.expectedAccessRevision,
    "AUTHORITY_STALE",
  );
  const p = (
    await tx.query(
      "SELECT * FROM goal_transition WHERE workspace_id=$1 AND id=$2",
      [w, c.transitionId],
    )
  ).rows[0];
  requireThat(p, "GOAL_TRANSITION_NOT_FOUND", 404);
  requireThat(
    !(
      await tx.query(
        "SELECT 1 FROM goal_transition_adoption WHERE workspace_id=$1 AND transition_id=$2",
        [w, p.id],
      )
    ).rowCount,
    "GOAL_TRANSITION_ALREADY_ADOPTED",
  );
  const g = await goalAt(tx, w, p.goal_id);
  requireThat(g.current_version === p.goal_version, "GOAL_VERSION_STALE");
  requireThat(
    g.status === p.base_status &&
      g.current_primary === p.base_primary &&
      g.parent_goal_id === p.base_parent_goal_id &&
      g.parent_goal_version === p.base_parent_goal_version,
    "GOAL_ROLE_STALE",
  );
  const basis = (
    await tx.query<{ act_id: string; blocking: boolean }>(
      "SELECT * FROM goal_transition_obligation WHERE workspace_id=$1 AND transition_id=$2 ORDER BY act_id",
      [w, p.id],
    )
  ).rows;
  requireThat(
    !basis.some((r) => r.blocking),
    "GOAL_REQUIRES_SEPARATE_OBLIGATION_CHANGE",
  );
  // Re-submitting the same proposed change cannot erase a previously reported necessary conflict.
  const priorConflict = await tx.query(
    "SELECT 1 FROM goal_transition t JOIN goal_transition_obligation b ON (b.workspace_id,b.transition_id)=(t.workspace_id,t.id) JOIN current_project_act a ON (a.workspace_id,a.id)=(b.workspace_id,b.act_id) WHERE t.workspace_id=$1 AND t.goal_id=$2 AND t.goal_version=$3 AND t.mode=$4 AND regexp_replace(lower(t.content),'\\s+',' ','g')=regexp_replace(lower($5::text),'\\s+',' ','g') AND b.blocking",
    [w, p.goal_id, p.goal_version, p.mode, p.content],
  );
  requireThat(
    !priorConflict.rowCount,
    "GOAL_REQUIRES_SEPARATE_OBLIGATION_CHANGE",
  );
  requireThat(
    JSON.stringify(basis.map((r) => r.act_id)) ===
      JSON.stringify(await currentActIds(tx, w)),
    "GOAL_OBLIGATION_BASIS_STALE",
  );
  const people = (
    await tx.query<{ person_id: string }>(
      "SELECT person_id FROM goal_transition_person WHERE workspace_id=$1 AND transition_id=$2",
      [w, p.id],
    )
  ).rows;
  requireThat(
    people.some((r) => r.person_id === c.representedPersonId),
    "NOT_A_NAMED_APPROVER",
    403,
  );
  const mandate = await projectAuthority(
    tx,
    w,
    actor,
    c.representedPersonId,
    "goal",
    p.goal_id,
    p.goal_version,
    capabilityForGoal(p.mode),
    c.mandateId,
  );
  await tx.query(
    "INSERT INTO goal_transition_approval(id,workspace_id,transition_id,person_id,actor_id,access_revision,mandate_id,mandate_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      w,
      p.id,
      c.representedPersonId,
      actor,
      ws.access_revision,
      mandate?.mandate_id ?? null,
      mandate?.version ?? null,
    ],
  );
  const approvals = (
    await tx.query(
      "SELECT DISTINCT ON(person_id) * FROM goal_transition_approval WHERE workspace_id=$1 AND transition_id=$2 AND access_revision=$3 ORDER BY person_id,created_at DESC,id DESC",
      [w, p.id, ws.access_revision],
    )
  ).rows;
  let adopted = false,
    resultId = g.id,
    resultVersion = g.current_version;
  if (approvals.length === people.length) {
    // New exact-version adherence changes the affected intent scope, never gets silently omitted.
    const currentPeople = (
      await tx.query<{ person_id: string }>(
        "SELECT person_id FROM goal_intent_participant WHERE workspace_id=$1 AND goal_id=$2 AND goal_version=$3 UNION SELECT user_id AS person_id FROM goal_adherence WHERE workspace_id=$1 AND goal_id=$2 AND goal_version=$3",
        [w, g.id, g.current_version],
      )
    ).rows;
    requireThat(
      currentPeople.every((r) =>
        people.some((p) => p.person_id === r.person_id),
      ),
      "GOAL_AFFECTED_SCOPE_CHANGED",
    );
    for (const a of approvals) {
      const m = await projectAuthority(
        tx,
        w,
        a.actor_id,
        a.person_id,
        "goal",
        p.goal_id,
        p.goal_version,
        capabilityForGoal(p.mode),
        a.mandate_id ?? undefined,
      );
      requireThat(
        !m || m.version === a.mandate_version,
        "MANDATE_VERSION_STALE",
      );
    }
    if (p.mode === "replace" || p.mode === "subgoal") {
      resultId = randomUUID();
      resultVersion = 1;
      if (p.mode === "replace")
        await tx.query(
          "UPDATE goal SET current_primary=false,status=$3 WHERE workspace_id=$1 AND id=$2",
          [w, g.id, p.previous_becomes_subgoal ? "active" : "replaced"],
        );
      await tx.query(
        "INSERT INTO goal(id,workspace_id,current_version,current_primary,status,parent_goal_id,parent_goal_version) VALUES($1,$2,1,$3,'active',$4,$5)",
        [
          resultId,
          w,
          p.mode === "replace",
          p.mode === "subgoal" ? g.id : null,
          p.mode === "subgoal" ? g.current_version : null,
        ],
      );
    } else {
      resultVersion = g.current_version + 1;
      await tx.query(
        "UPDATE goal SET current_version=$3,status=$4,current_primary=CASE WHEN $4='active' THEN current_primary ELSE false END WHERE workspace_id=$1 AND id=$2",
        [
          w,
          g.id,
          resultVersion,
          p.mode === "complete"
            ? "completed"
            : p.mode === "abandon"
              ? "abandoned"
              : "active",
        ],
      );
    }
    await tx.query(
      "INSERT INTO goal_version(workspace_id,goal_id,version,content,established_by,source_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [w, resultId, resultVersion, p.content, actor, p.source_id, p.reason],
    );
    for (const person of people)
      await tx.query(
        "INSERT INTO goal_intent_participant VALUES($1,$2,$3,$4)",
        [w, resultId, resultVersion, person.person_id],
      );
    await tx.query(
      "INSERT INTO goal_transition_adoption(workspace_id,transition_id,goal_id,goal_version) VALUES($1,$2,$3,$4)",
      [w, p.id, resultId, resultVersion],
    );
    if (p.mode === "replace" || p.mode === "subgoal")
      await tx.query(
        "INSERT INTO goal_relation(id,workspace_id,from_goal_id,from_version,to_goal_id,to_version,kind,transition_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          w,
          g.id,
          g.current_version,
          resultId,
          resultVersion,
          p.mode === "replace" ? "replaces" : "subgoal",
          p.id,
        ],
      );
    if (p.mode === "replace" && p.previous_becomes_subgoal) {
      await tx.query(
        "UPDATE goal SET parent_goal_id=$3,parent_goal_version=$4 WHERE workspace_id=$1 AND id=$2",
        [w, g.id, resultId, resultVersion],
      );
      await tx.query(
        "INSERT INTO goal_relation(id,workspace_id,from_goal_id,from_version,to_goal_id,to_version,kind,transition_id) VALUES($1,$2,$3,$4,$5,$6,'subgoal',$7)",
        [
          randomUUID(),
          w,
          resultId,
          resultVersion,
          g.id,
          g.current_version,
          p.id,
        ],
      );
    }
    adopted = true;
  }
  await changed(tx, w, c.type, adopted);
  return { adopted, goalId: resultId, version: resultVersion };
}

async function approveProject(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: Extract<ProjectCommand, { type: "project.approve" }>,
) {
  const w = ws.id;
  requireThat(
    ws.access_revision === c.expectedAccessRevision,
    "AUTHORITY_STALE",
  );
  const p = (
    await tx.query(
      "SELECT * FROM normative_proposal WHERE workspace_id=$1 AND id=$2",
      [w, c.proposalId],
    )
  ).rows[0];
  requireThat(p, "PROPOSAL_NOT_FOUND", 404);
  requireThat(
    !(
      await tx.query(
        "SELECT 1 FROM project_act WHERE workspace_id=$1 AND proposal_id=$2",
        [w, p.id],
      )
    ).rowCount,
    "ALREADY_ADOPTED",
  );
  if (p.goal_id) {
    const g = await goalAt(tx, w, p.goal_id);
    requireThat(
      g.current_version === p.goal_version && g.status === "active",
      "GOAL_VERSION_STALE",
    );
  }
  if (p.replaces_act_id)
    requireThat(
      (
        await tx.query(
          "SELECT 1 FROM current_project_act WHERE workspace_id=$1 AND id=$2",
          [w, p.replaces_act_id],
        )
      ).rowCount,
      "PROJECT_ACT_NOT_CURRENT",
    );
  // Legacy proposals retain their original strict context gate.
  if (!p.source_id)
    requireThat(p.context_revision === ws.context_revision, "PROPOSAL_STALE");
  const people = (
    await tx.query<{ person_id: string }>(
      "SELECT person_id FROM required_project_approval WHERE workspace_id=$1 AND proposal_id=$2",
      [w, p.id],
    )
  ).rows;
  requireThat(
    people.some((r) => r.person_id === c.representedPersonId),
    "NOT_A_NAMED_APPROVER",
    403,
  );
  const scopeKind = p.replaces_act_id ? "act" : "goal",
    scopeId = p.replaces_act_id ?? p.goal_id,
    scopeVersion = p.replaces_act_id ? 1 : p.goal_version,
    capability =
      p.operation === "replace"
        ? "act.replace"
        : p.operation === "revoke"
          ? "act.revoke"
          : "act.create";
  if (c.mandateId) requireThat(scopeId, "MANDATE_SCOPE_REQUIRED", 403);
  const m = await projectAuthority(
    tx,
    w,
    actor,
    c.representedPersonId,
    scopeKind,
    scopeId ?? "",
    scopeVersion ?? 0,
    capability,
    c.mandateId,
  );
  await tx.query(
    "INSERT INTO project_approval(id,workspace_id,proposal_id,person_id,context_revision,access_revision,actor_id,mandate_id,mandate_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      w,
      p.id,
      c.representedPersonId,
      ws.context_revision,
      ws.access_revision,
      actor,
      m?.mandate_id ?? null,
      m?.version ?? null,
    ],
  );
  const approvals = (
    await tx.query(
      "SELECT DISTINCT ON(person_id) * FROM project_approval WHERE workspace_id=$1 AND proposal_id=$2 AND access_revision=$3 ORDER BY person_id,created_at DESC,id DESC",
      [w, p.id, ws.access_revision],
    )
  ).rows;
  let adopted = false,
    actId: string | null = null;
  if (approvals.length === people.length) {
    for (const a of approvals) {
      const mandate = await projectAuthority(
        tx,
        w,
        a.actor_id ?? a.person_id,
        a.person_id,
        scopeKind,
        scopeId ?? "",
        scopeVersion ?? 0,
        capability,
        a.mandate_id ?? undefined,
      );
      requireThat(
        !mandate || mandate.version === a.mandate_version,
        "MANDATE_VERSION_STALE",
      );
    }
    actId = randomUUID();
    await tx.query(
      "INSERT INTO project_act(id,workspace_id,proposal_id) VALUES($1,$2,$3)",
      [actId, w, p.id],
    );
    for (const a of approvals)
      await tx.query("INSERT INTO act_approval VALUES($1,$2,$3)", [
        w,
        actId,
        a.id,
      ]);
    if (p.replaces_act_id)
      await tx.query(
        "INSERT INTO project_act_supersession(workspace_id,act_id,successor_id,operation) VALUES($1,$2,$3,$4)",
        [w, p.replaces_act_id, actId, p.operation],
      );
    adopted = true;
  }
  await changed(tx, w, c.type, adopted);
  return { adopted, actId };
}
