import { conversationMilestones } from "../src/server/conversation-milestones";
import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { projectView } from "../src/server/project-queries";
import { referenceDetail } from "../src/server/conversation-reference";
import { messages, state } from "../src/server/sync";
async function person() {
  const email = `${randomUUID()}@example.test`,
    password = "Project-test-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Project tester" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } });
  return {
    id: user.id,
    email,
    session: (
      await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
    ).rows[0].id as string,
  };
}
type Person = Awaited<ReturnType<typeof person>>;
async function setup(n = 3) {
  const people: Person[] = [];
  for (let i = 0; i < n; i++) people.push(await person());
  const [a, b, c] = people,
    w = (await createWorkspace(a.id, "Project governance", randomUUID())).id;
  const command = (input: unknown, as = a, key = randomUUID()) =>
    execute(as.id, w, key, input, as.session);
  for (const p of people.slice(1)) {
    const inv = await command({
      type: "invitation.create",
      email: p.email,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(p.id, String(inv.token), true);
  }
  const goalId = String(
    (
      await command({
        type: "goal.establish",
        content: "Aprire un cocktail bar a Milano",
      })
    ).goalId,
  );
  const view = (as = a) => projectView(as.id, w);
  const goal = async () => (await view()).goals.find((g) => g.id === goalId)!;
  const proposeGoal = async (
    mode = "revise",
    extra: Record<string, unknown> = {},
    as = a,
  ) =>
    command(
      {
        type: "goal.propose",
        goalId,
        expectedVersion: (await goal()).version,
        mode,
        content: "Aprire un cocktail bar premium a Milano",
        reason: "Evoluzione esplicita dell’intento",
        preserveExistingObligations: true,
        ...extra,
      },
      as,
    );
  const approveGoal = async (
    id: string,
    as = a,
    represented = as.id,
    mandateId?: string,
  ) =>
    command(
      {
        type: "goal.approve",
        transitionId: id,
        expectedAccessRevision: (await view(as)).accessRevision,
        representedPersonId: represented,
        confirmExactContent: true,
        ...(mandateId ? { mandateId } : {}),
      },
      as,
    );
  const proposeAct = async (
    kind = "constraint",
    extra: Record<string, unknown> = {},
    as = a,
  ) =>
    command(
      {
        type: "project.propose",
        kind,
        content: "Il limite di spesa assunto è 80.000 euro",
        people: [a.id, b.id],
        goal: { id: goalId, version: (await goal()).version },
        reason: "Accordo esplicito, non inferenza",
        ...extra,
      },
      as,
    );
  const approveAct = async (
    id: string,
    as = a,
    represented = as.id,
    mandateId?: string,
  ) =>
    command(
      {
        type: "project.approve",
        proposalId: id,
        expectedAccessRevision: (await view(as)).accessRevision,
        representedPersonId: represented,
        confirmExactContent: true,
        ...(mandateId ? { mandateId } : {}),
      },
      as,
    );
  const grant = async (
    grantor: Person,
    holder: Person,
    capability = "goal.change",
    scope?: unknown,
  ) => {
    const id = String(
      (
        await command(
          {
            type: "mandate.offer",
            holderId: holder.id,
            scope: scope ?? {
              kind: "goal",
              id: goalId,
              version: (await goal()).version,
            },
            capability,
            expiresAt: null,
            reason: "Rappresenta soltanto me entro questi termini",
            representSelf: true,
          },
          grantor,
        )
      ).mandateId,
    );
    await command(
      {
        type: "mandate.respond",
        mandateId: id,
        expectedVersion: 1,
        response: "accept",
        reason: "Accetto lo scope preciso e le condizioni",
      },
      holder,
    );
    return id;
  };
  return {
    a,
    b,
    c,
    w,
    people,
    command,
    goalId,
    goal,
    view,
    proposeGoal,
    approveGoal,
    proposeAct,
    approveAct,
    grant,
  };
}
afterAll(() => pool.end());
describe("Goal and bounded project authority", () => {
  it("records a contributor’s shared Goal edit once with exact, inspectable history and no transfer of consent or authority", async () => {
    const s = await setup();
    await s.command({ type: "goal.adhere", goalId: s.goalId, version: 1 }, s.b);
    const original = await s.goal();
    const originalProposal = String((await s.proposeGoal()).transitionId);
    const key = randomUUID();
    const input = {
      type: "goal.editShared",
      goalId: s.goalId,
      expectedVersion: 1,
      content: "Aprire il nostro primo locale a Milano.",
    };
    const result = await s.command(input, s.c, key);
    expect(await s.command(input, s.c, key)).toEqual(result);
    await s.command({ ...input, expectedVersion: 2 }, s.b);
    await expect(s.approveGoal(originalProposal)).rejects.toThrow(
      "GOAL_VERSION_STALE",
    );
    const goal = await s.goal();
    expect(goal).toMatchObject({
      version: 2,
      content: input.content,
      status: "active",
      participants: [],
      adherences: [{ personId: s.b.id, version: 1 }],
    });
    expect(goal.versions[1]).toEqual(original.versions[0]);
    const timeline = (
      await messages(
        s.b.id,
        s.w,
        0,
        (await state(s.b.id, s.w)).messageSequence,
        100,
      )
    ).messages;
    const notices = timeline.filter(
      (message) => message.purpose === "goal_event",
    );
    expect(notices).toHaveLength(2);
    for (const [index, notice] of notices.entries()) {
      const version = index + 1,
        actor = index === 0 ? s.a.id : s.c.id;
      const ref = { kind: "goal" as const, id: s.goalId, version };
      expect(notice).toMatchObject({
        authorId: actor,
        actorKind: "human",
        reference: ref,
      });
      expect(goal.versions.find((v) => v.version === version)).toMatchObject({
        actor,
        sourceId: notice.id,
      });
      expect(await referenceDetail(s.b.id, s.w, ref)).toMatchObject({
        actor,
        sourceIds: [notice.id],
        current: version === 2,
      });
      expect(
        await referenceDetail(s.b.id, s.w, {
          kind: "source",
          id: notice.id,
          version: 1,
        }),
      ).toMatchObject({
        actor,
        content: notice.content,
        qualification: expect.stringContaining("operazione"),
      });
    }
    const ids = notices.map((notice) => notice.id);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM workspace_source WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
          [s.w, ids],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM interpretation WHERE workspace_id=$1 AND source_id=ANY($2::uuid[])",
          [s.w, ids],
        )
      ).rowCount,
    ).toBe(0);
    const view = await s.view();
    expect(view.mandates).toEqual([]);
    expect(view.acts).toEqual([]);
    for (const mode of ["complete", "replace"]) {
      const proposal = String(
        (
          await s.proposeGoal(
            mode,
            {
              content:
                mode === "complete"
                  ? goal.content
                  : "Avviare una nuova attività",
            },
            s.c,
          )
        ).transitionId,
      );
      const pending = (await s.view()).goalProposals.find(
        (p) => p.id === proposal,
      )!;
      expect(pending.people.sort()).toEqual([s.a.id, s.b.id].sort());
      await expect(s.approveGoal(proposal, s.c)).rejects.toThrow(
        "NOT_A_NAMED_APPROVER",
      );
      await expect(s.approveGoal(proposal, s.c, s.b.id)).rejects.toThrow(
        "PERTINENT_MANDATE_REQUIRED",
      );
      await s.approveGoal(proposal, s.a);
      expect(
        (await s.view()).goalProposals.find((p) => p.id === proposal)?.status,
      ).toBe("pending");
    }
    expect((await s.goal()).status).toBe("active");
  });
  it("serializes competing shared edits and rejects foreign, observer, ended and ineligible authors", async () => {
    const s = await setup();
    const input = {
      type: "goal.editShared",
      goalId: s.goalId,
      expectedVersion: 1,
      content: "Concentrarci sull’apertura del locale.",
    };
    const race = await Promise.allSettled([
      s.command(input, s.a),
      s.command(
        { ...input, content: "Organizzare l’apertura di primavera." },
        s.b,
      ),
    ]);
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(race.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "GOAL_VERSION_STALE" },
    });
    const next = {
      ...input,
      expectedVersion: 2,
      content: "Operazione non autorizzata",
    };
    const other = (await createWorkspace(s.b.id, "Altro spazio", randomUUID()))
      .id;
    await expect(
      execute(s.b.id, other, randomUUID(), next, s.b.session),
    ).rejects.toThrow("GOAL_NOT_FOUND");
    await expect(execute(s.b.id, s.w, randomUUID(), next)).rejects.toThrow(
      "AUTHENTICATED_SESSION_REQUIRED",
    );
    await pool.query(
      "UPDATE membership SET contributes=false WHERE workspace_id=$1 AND user_id=$2",
      [s.w, s.c.id],
    );
    await expect(s.command(next, s.c)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await s.command({ type: "member.leave", confirmed: true }, s.b);
    await expect(s.command(next, s.b)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [s.a.id]);
    await expect(s.command(next, s.a)).rejects.toThrow("ACCOUNT_INELIGIBLE");
    expect(
      (await s.view(s.c)).goals.find((g) => g.id === s.goalId)?.versions,
    ).toHaveLength(2);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM message WHERE workspace_id=$1 AND purpose='goal_event'",
          [s.w],
        )
      ).rowCount,
    ).toBe(2);
  });
  it("shows an approved decision once at the preceding message and never turns a proposal into a timeline decision", async () => {
    const s = await setup(2),
      outsider = await person();
    const sent = await s.command({
      type: "message.send",
      content: "Confrontiamo le opzioni.",
    });
    const first = String(sent.messageId);
    const proposal = String((await s.proposeAct("decision")).proposalId);
    expect(
      (await conversationMilestones(s.b.id, s.w, first, first)).items,
    ).toEqual([]);
    await s.approveAct(proposal);
    expect(
      (await conversationMilestones(s.b.id, s.w, first, first)).items,
    ).toEqual([]);
    const atApproval = (
      await pool.query(
        "SELECT id FROM message WHERE workspace_id=$1 ORDER BY sequence DESC LIMIT 1",
        [s.w],
      )
    ).rows[0].id;
    await s.approveAct(proposal, s.b);
    const second = String(
      (await s.command({ type: "message.send", content: "Andiamo avanti." }))
        .messageId,
    );
    const view = await conversationMilestones(s.b.id, s.w, first, second);
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      kind: "decision",
      objectId: proposal,
      anchor: atApproval,
    });
    expect(
      (await conversationMilestones(s.a.id, s.w, second, second)).items,
    ).toEqual([]);
    await expect(
      conversationMilestones(outsider.id, s.w, first, second),
    ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  });
  it("uses explicit pertinent consent without membership authority or transferred adherence", async () => {
    const s = await setup();
    await s.command({ type: "goal.adhere", goalId: s.goalId, version: 1 }, s.b);
    const id = String((await s.proposeGoal("revise", {}, s.c)).transitionId);
    const proposal = (await s.view()).goalProposals.find((p) => p.id === id)!;
    expect(proposal.people.sort()).toEqual([s.a.id, s.b.id].sort());
    await expect(s.approveGoal(id, s.c, s.a.id)).rejects.toThrow(
      "PERTINENT_MANDATE_REQUIRED",
    );
    await s.approveGoal(id);
    expect((await s.goal()).version).toBe(1);
    await s.approveGoal(id, s.b);
    const g = await s.goal();
    expect(g.version).toBe(2);
    expect(g.versions).toHaveLength(2);
    expect(g.adherences).toEqual([{ personId: s.b.id, version: 1 }]);
    expect(g.content).toContain("premium");
    expect(
      (await state(s.a.id, s.w)).goals.find((g) => g.id === s.goalId)?.version,
    ).toBe(2);
  });
  it("requires accepted exact-scope mandates and suspends old approvals on representation contest", async () => {
    const s = await setup();
    await s.command({ type: "goal.adhere", goalId: s.goalId, version: 1 }, s.b);
    const ma = await s.grant(s.a, s.c),
      mb = await s.grant(s.b, s.c);
    const id = String((await s.proposeGoal()).transitionId);
    await s.approveGoal(id, s.c, s.a.id, ma);
    await s.command({
      type: "mandate.respond",
      mandateId: ma,
      expectedVersion: 2,
      response: "contest",
      reason: "Contesto la rappresentanza per i nuovi usi",
    });
    await expect(s.approveGoal(id, s.c, s.b.id, mb)).rejects.toThrow(
      "MANDATE_NOT_APPLICABLE",
    );
    expect((await s.goal()).version).toBe(1);
    await s.command({
      type: "mandate.respond",
      mandateId: ma,
      expectedVersion: 3,
      response: "confirm",
      reason: "Riconfermo esattamente la stessa rappresentanza",
    });
    await s.approveGoal(id, s.c, s.a.id, ma);
    await s.approveGoal(id, s.c, s.b.id, mb);
    expect((await s.goal()).version).toBe(2);
    const newer = String(
      (
        await s.proposeGoal("revise", {
          content: "Aprire un cocktail bar premium a Roma",
        })
      ).transitionId,
    );
    await expect(s.approveGoal(newer, s.c, s.a.id, ma)).rejects.toThrow(
      "MANDATE_NOT_APPLICABLE",
    );
    const m = (await s.view()).mandates.find((m) => m.id === ma)!;
    expect(m.versions.map((v) => v.status)).toEqual([
      "accepted",
      "contested",
      "accepted",
      "offered",
    ]);
    expect(m.terms).toContain("stesse partecipazioni");
  });
  it("creates lineage and Sub-goals while preserving prior identities, obligations and historical completion", async () => {
    const s = await setup();
    const sub = String(
      (await s.proposeGoal("subgoal", { content: "Ottenere la licenza" }))
        .transitionId,
    );
    const result = await s.approveGoal(sub);
    const subId = String(result.goalId);
    expect((await s.view()).goals.find((g) => g.id === subId)).toMatchObject({
      parentGoalId: s.goalId,
      parentGoalVersion: 1,
      currentPrimary: false,
    });
    await s.command({ type: "goal.adhere", goalId: subId, version: 1 }, s.b);
    const pending = String((await s.proposeGoal("revise")).transitionId);
    const replacement = String(
      (
        await s.proposeGoal("replace", {
          content: "Creare una catena di cocktail bar",
          previousBecomesSubgoal: true,
        })
      ).transitionId,
    );
    const adopted = await s.approveGoal(replacement);
    expect((await s.view()).goals.filter((g) => g.currentPrimary)).toHaveLength(
      1,
    );
    expect((await s.goal()).parentGoalId).toBe(adopted.goalId);
    expect((await s.goal()).status).toBe("active");
    await expect(s.approveGoal(pending)).rejects.toThrow("GOAL_ROLE_STALE");
    expect((await s.view()).relations).toHaveLength(3);
  });
  it("supports typed acts and separately authorized replacement/revocation without erasing history", async () => {
    const s = await setup();
    const p = String((await s.proposeAct()).proposalId);
    await s.approveAct(p);
    const result = await s.approveAct(p, s.b);
    const actId = String(result.actId);
    expect((await s.view()).acts.find((a) => a.actId === actId)).toMatchObject({
      kind: "constraint",
      status: "effective",
      candidateId: null,
    });
    expect(
      (await state(s.a.id, s.w)).commitments.find((c) => c.id === p)
        ?.candidateId,
    ).toBeNull();
    const rev = String(
      (
        await s.proposeAct(
          "decision",
          {
            operation: "revoke",
            replacesActId: actId,
            content: "Revochiamo il limite precedente",
            people: [s.c.id],
          },
          s.c,
        )
      ).proposalId,
    );
    const record = (await s.view()).acts.find((a) => a.proposalId === rev)!;
    expect(record.people.sort()).toEqual([s.a.id, s.b.id, s.c.id].sort());
    await s.approveAct(rev, s.c);
    await s.approveAct(rev, s.a);
    await s.approveAct(rev, s.b);
    expect((await s.view()).acts.find((a) => a.actId === actId)?.status).toBe(
      "superseded",
    );
    expect(
      (
        await pool.query(
          "SELECT 1 FROM project_act WHERE workspace_id=$1 AND id=$2",
          [s.w, actId],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM current_project_act WHERE workspace_id=$1 AND id=$2",
          [s.w, actId],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("does not let Goal authority override a reported necessary obligation change", async () => {
    const s = await setup();
    const p = String((await s.proposeAct()).proposalId);
    await s.approveAct(p);
    const act = String((await s.approveAct(p, s.b)).actId);
    const blocked = String(
      (await s.proposeGoal("revise", { blockingActIds: [act] })).transitionId,
    );
    expect(
      (await s.view()).goalProposals.find((p) => p.id === blocked)?.status,
    ).toBe("blocked");
    await expect(s.approveGoal(blocked)).rejects.toThrow(
      "GOAL_REQUIRES_SEPARATE_OBLIGATION_CHANGE",
    );
    const blockedText = (await s.view()).goalProposals.find(
      (p) => p.id === blocked,
    )!.content;
    const directEdit = {
      type: "goal.editShared",
      goalId: s.goalId,
      expectedVersion: 1,
      content: blockedText,
    };
    await expect(s.command(directEdit, s.c)).rejects.toThrow(
      "GOAL_REQUIRES_SEPARATE_OBLIGATION_CHANGE",
    );
    const duplicate = String((await s.proposeGoal()).transitionId);
    await expect(s.approveGoal(duplicate)).rejects.toThrow(
      "GOAL_REQUIRES_SEPARATE_OBLIGATION_CHANGE",
    );
    const permitted = String(
      (
        await s.proposeGoal("revise", {
          content:
            "Aprire un piccolo cocktail bar a Milano entro il limite già assunto",
        })
      ).transitionId,
    );
    await s.approveGoal(permitted);
    await expect(
      s.command(
        { ...directEdit, expectedVersion: (await s.goal()).version },
        s.c,
      ),
    ).rejects.toThrow("GOAL_REQUIRES_SEPARATE_OBLIGATION_CHANGE");
    expect((await s.view()).acts.find((a) => a.actId === act)?.status).toBe(
      "effective",
    );
    await expect(
      s.proposeGoal("complete", { content: "Un obiettivo diverso" }),
    ).rejects.toThrow("GOAL_CONTENT_CHANGE_REQUIRES_REVISION");
    const finish = String(
      (await s.proposeGoal("complete", { content: (await s.goal()).content }))
        .transitionId,
    );
    await s.approveGoal(finish);
    expect((await s.goal()).status).toBe("completed");
    expect((await s.view()).acts.find((a) => a.actId === act)?.status).toBe(
      "effective",
    );
  });
  it("uses scoped act authority without granting external capability and revalidates revocation", async () => {
    const s = await setup();
    const m = await s.grant(s.b, s.c, "act.create");
    const p = String((await s.proposeAct("decision")).proposalId);
    await s.approveAct(p, s.c, s.b.id, m);
    await s.command(
      {
        type: "mandate.respond",
        mandateId: m,
        expectedVersion: 2,
        response: "revoke",
        reason: "Non rappresentarmi più nei nuovi atti",
      },
      s.b,
    );
    await expect(s.approveAct(p)).rejects.toThrow("MANDATE_NOT_APPLICABLE");
    await s.approveAct(p, s.b);
    await s.approveAct(p);
    expect((await s.view()).acts.find((a) => a.proposalId === p)?.status).toBe(
      "effective",
    );
    await expect(s.grant(s.a, s.b, "act.replace")).rejects.toThrow(
      "MANDATE_SCOPE_CAPABILITY_MISMATCH",
    );
    expect((await s.view()).mandates.find((x) => x.id === m)?.status).toBe(
      "revoked",
    );
  });
  it("rejects late/stale/foreign proposals and prevents ended participation from reviving a mandate", async () => {
    const s = await setup();
    const m = await s.grant(s.a, s.b);
    const first = String((await s.proposeGoal()).transitionId),
      second = String((await s.proposeGoal()).transitionId);
    await s.approveGoal(first);
    await expect(s.approveGoal(second)).rejects.toThrow("GOAL_VERSION_STALE");
    const other = await setup(2);
    await expect(other.approveGoal(first)).rejects.toThrow(
      "GOAL_TRANSITION_NOT_FOUND",
    );
    await s.command({ type: "member.leave", confirmed: true }, s.b);
    const invite = await s.command({
      type: "invitation.create",
      email: s.b.email,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(s.b.id, String(invite.token), true);
    expect((await s.view()).mandates.find((x) => x.id === m)?.available).toBe(
      false,
    );
    await expect(
      pool.query(
        "UPDATE goal_version SET content='erase history' WHERE workspace_id=$1",
        [s.w],
      ),
    ).rejects.toThrow("immutable historical record");
    await pool.query("DELETE FROM session WHERE id=$1", [s.a.session]);
    await expect(
      s.command({ type: "goal.adhere", goalId: s.goalId, version: 2 }),
    ).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });
});
