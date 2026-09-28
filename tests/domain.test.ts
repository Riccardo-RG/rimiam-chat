import { fixtureInterpreter } from "./support/fixture-interpreter";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { snapshot, invitationDetails } from "../src/server/queries";
import {
  claimInterpretation,
  publishInterpretation,
  processInterpretation,
  retrieveSources,
  recoverExpiredInterpretations,
  type Interpreter,
} from "../src/server/interpretation";

async function user() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$2,$3,true,now(),now(),true)',
    [id, `Person ${id.slice(0, 6)}`, `${id}@example.test`],
  );
  return id;
}
async function email(id: string) {
  return (await pool.query('SELECT email FROM "user" WHERE id=$1', [id]))
    .rows[0].email as string;
}
async function setup() {
  const a = await user(),
    b = await user(),
    w = (await createWorkspace(a, "Test Workspace", randomUUID())).id;
  return { a, b, w };
}
async function invite(a: string, b: string, w: string) {
  return execute(a, w, randomUUID(), {
    type: "invitation.create",
    email: await email(b),
    fullHistoryDisclosed: true,
  }) as Promise<{ token: string; invitationId: string }>;
}
async function join(a: string, b: string, w: string) {
  const i = await invite(a, b, w);
  await acceptInvitation(b, i.token, true);
  return i;
}
async function say(
  actor: string,
  w: string,
  content = "Il locale costa €3.000 al mese.",
) {
  const m = (await execute(actor, w, randomUUID(), {
    type: "message.send",
    content,
  })) as { messageId: string; interpretationId: string };
  await processInterpretation(m.interpretationId, fixtureInterpreter);
  const candidate = (
    await pool.query(
      "SELECT * FROM candidate WHERE workspace_id=$1 AND interpretation_id=$2 ORDER BY created_at DESC",
      [w, m.interpretationId],
    )
  ).rows[0];
  return { ...m, candidate };
}
const accept = (actor: string, w: string, candidateId: string) =>
  execute(actor, w, randomUUID(), {
    type: "information.accept",
    candidateId,
    descriptiveOnly: true,
  });
afterAll(async () => {
  await pool.end();
});

describe("PostgreSQL domain commands", () => {
  it("preserves inferred origin, source and uncertainty when information is explicitly accepted", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    const m = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "Miriam, cosa deduci sui costi?",
    });
    await processInterpretation(m.interpretationId, {
      async interpret(c) {
        return {
          needsMore: [],
          proposals: [
            {
              subject: "Stima indicativa",
              content: "Il costo potrebbe essere 3.000 euro",
              classification: "descriptive",
              origin: "inferred",
              qualification:
                "Ipotesi, non verificata; non una dichiarazione della persona.",
              sourceIds: [c.trigger.id],
            },
          ],
        };
      },
    });
    const before = await snapshot(b, w),
      candidate = before.candidates[0];
    expect(before.information).toHaveLength(0);
    expect(candidate.uses).toEqual({
      information: [],
      questions: [],
      proposals: [],
    });
    await accept(b, w, candidate.id);
    const after = await snapshot(b, w);
    expect(after.information[0]).toMatchObject({
      candidate_id: candidate.id,
      qualification: candidate.qualification,
      accepted_by: b,
      current_version: 1,
    });
    expect(after.candidates[0]).toMatchObject({
      origin: "inferred",
      source_id: m.messageId,
      source_ids: [m.messageId],
      uses: {
        information: [
          { id: after.information[0].id, version: 1, current: true },
        ],
      },
    });
    expect(after.commitments).toHaveLength(0);
  });
  it("creates ordinary attributable bootstrap state with no implicit Goal, adherence or project authority", async () => {
    const { a, w } = await setup();
    const state = await snapshot(a, w);
    expect(state.access).toHaveLength(1);
    expect(state.access[0]).toMatchObject({
      holder_id: a,
      basis: "workspace_initialization",
      invitations: true,
      change_access: true,
    });
    expect(state.goals).toHaveLength(0);
    expect(state.adherences).toHaveLength(0);
    expect(state.commitments).toHaveLength(0);
    expect(
      (
        await pool.query("SELECT * FROM access_history WHERE workspace_id=$1", [
          w,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("denies all shared reads before admission; gives full retained history after explicit recipient acceptance", async () => {
    const { a, b, w } = await setup();
    await say(a, w);
    const invitation = await invite(a, b, w);
    await expect(snapshot(b, w)).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
    await expect(acceptInvitation(b, invitation.token, false)).rejects.toThrow(
      "HISTORY_ACCEPTANCE_REQUIRED",
    );
    const stranger = await user();
    await expect(
      acceptInvitation(stranger, invitation.token, true),
    ).rejects.toThrow("INVITATION_RECIPIENT_MISMATCH");
    await expect(invitationDetails(stranger, invitation.token)).rejects.toThrow(
      "INVITATION_INVALID",
    );
    await acceptInvitation(b, invitation.token, true);
    expect((await snapshot(b, w)).messages).toHaveLength(2);
    await expect(acceptInvitation(b, invitation.token, true)).rejects.toThrow(
      "INVITATION_INVALID",
    );
    await expect(
      execute(b, w, randomUUID(), {
        type: "invitation.create",
        email: await email(stranger),
        fullHistoryDisclosed: true,
      }),
    ).rejects.toThrow("ACCESS_AUTHORITY_REQUIRED");
    expect((await snapshot(b, w)).adherences).toHaveLength(0);
  });
  it("requires explicit version-bound Goal adherence, independent of invitation", async () => {
    const { a, b, w } = await setup();
    const g = await execute(a, w, randomUUID(), {
      type: "goal.establish",
      content: "Aprire un cocktail bar a Milano",
    });
    await join(a, b, w);
    expect((await snapshot(b, w)).adherences).toHaveLength(0);
    await expect(
      execute(b, w, randomUUID(), {
        type: "goal.adhere",
        goalId: g.goalId,
        version: 2,
      }),
    ).rejects.toThrow("GOAL_VERSION_STALE");
    await execute(b, w, randomUUID(), {
      type: "goal.adhere",
      goalId: g.goalId,
      version: 1,
    });
    expect((await snapshot(b, w)).adherences[0]).toMatchObject({
      user_id: b,
      goal_version: 1,
    });
    await expect(
      execute(b, w, randomUUID(), {
        type: "goal.establish",
        content: "Cambiare progetto",
      }),
    ).rejects.toThrow("GOAL_CHANGE_REQUIRES_SEPARATE_TRANSITION");
  });
  it("rejects revoked, expired, and no-longer-authorized invitations; creator history supplies no override", async () => {
    const { a, b, w } = await setup();
    const first = await invite(a, b, w);
    await execute(a, w, randomUUID(), {
      type: "invitation.revoke",
      invitationId: first.invitationId,
    });
    await expect(acceptInvitation(b, first.token, true)).rejects.toThrow(
      "INVITATION_INVALID",
    );
    const expired = await invite(a, b, w);
    await pool.query(
      "UPDATE invitation SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.invitationId],
    );
    await expect(acceptInvitation(b, expired.token, true)).rejects.toThrow(
      "INVITATION_INVALID",
    );
    const pending = await invite(a, b, w);
    await execute(a, w, randomUUID(), {
      type: "access.relinquish",
      confirmed: true,
    });
    await expect(acceptInvitation(b, pending.token, true)).rejects.toThrow(
      "ACCESS_AUTHORITY_REQUIRED",
    );
    await expect(invite(a, b, w)).rejects.toThrow("ACCESS_AUTHORITY_REQUIRED");
    await say(a, w);
    expect((await snapshot(a, w)).messages).toHaveLength(2);
  });
  it("revalidates account eligibility and admission does not retroactively end when its authorizer leaves", async () => {
    const { a, b, w } = await setup();
    const pending = await invite(a, b, w);
    await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [a]);
    await expect(acceptInvitation(b, pending.token, true)).rejects.toThrow(
      "ACCOUNT_INELIGIBLE",
    );
    await pool.query('UPDATE "user" SET eligible=true WHERE id=$1', [a]);
    await acceptInvitation(b, pending.token, true);
    await execute(a, w, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    await say(b, w);
    expect((await snapshot(b, w)).messages).toHaveLength(2);
    await expect(snapshot(a, w)).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
    expect(
      (
        await pool.query(
          "SELECT * FROM access_relationship WHERE workspace_id=$1 AND active",
          [w],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("serializes duplicate commands and rejects reused keys with different content", async () => {
    const { a, w } = await setup();
    const key = randomUUID(),
      command = { type: "message.send", content: "Messaggio unico" };
    const [one, two] = await Promise.all([
      execute(a, w, key, command),
      execute(a, w, key, command),
    ]);
    expect(one).toEqual(two);
    expect((await snapshot(a, w)).messages).toHaveLength(2);
    await expect(
      execute(a, w, key, { ...command, content: "Diverso" }),
    ).rejects.toThrow("COMMAND_ID_REUSED");
    expect(
      (
        await pool.query("SELECT * FROM interpretation WHERE workspace_id=$1", [
          w,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("does not promote AI output; allows attributed editorial acceptance without a mandate and preserves corrections", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    const one = await say(a, w);
    expect((await snapshot(b, w)).information).toHaveLength(0);
    await accept(b, w, one.candidate.id);
    const original = (await snapshot(b, w)).information[0];
    expect(original.accepted_by).toBe(b);
    const two = await say(a, w, "No, il locale costa €3.500 al mese.");
    expect((await snapshot(b, w)).information[0].content).toContain("3.000");
    await expect(accept(b, w, two.candidate.id)).rejects.toThrow(
      "INFORMATION_EXISTS_USE_CORRECTION",
    );
    await execute(b, w, randomUUID(), {
      type: "information.correct",
      informationId: original.id,
      expectedVersion: 1,
      candidateId: two.candidate.id,
      reason: "Nuova comunicazione del proprietario",
      descriptiveOnly: true,
    });
    const state = await snapshot(b, w);
    expect(state.information[0].current_version).toBe(2);
    expect(state.versions).toHaveLength(2);
    expect(
      state.messages.find((m) => m.id === one.messageId)!.content,
    ).toContain("3.000");
    expect(state.candidates).toHaveLength(2);
    expect(
      state.candidates.find((c) => c.id === one.candidate.id).uses.information,
    ).toEqual([{ id: original.id, version: 1, current: false }]);
    expect(
      state.candidates.find((c) => c.id === two.candidate.id).uses.information,
    ).toEqual([{ id: original.id, version: 2, current: true }]);
    expect(state.versions[0].qualification).toBe(one.candidate.qualification);
    expect(state.versions[0].candidate_id).toBe(one.candidate.id);
    expect(state.versions[0].accepted_by).toBe(b);
    await expect(
      pool.query("UPDATE message SET content='rewritten' WHERE id=$1", [
        one.messageId,
      ]),
    ).rejects.toThrow("immutable historical record");
    await expect(
      pool.query(
        "UPDATE information_version SET content='rewritten' WHERE information_id=$1",
        [original.id],
      ),
    ).rejects.toThrow("immutable historical record");
  });
  it("rejects cross-Workspace references at commands and composite foreign keys", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    const other = (await createWorkspace(b, "Other", randomUUID())).id;
    const source = await say(b, other);
    await expect(accept(a, w, source.candidate.id)).rejects.toThrow(
      "CANDIDATE_NOT_FOUND",
    );
    await expect(
      execute(a, other, randomUUID(), {
        type: "message.send",
        content: "No access",
      }),
    ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
    const local = await say(a, w);
    await expect(
      pool.query(
        "INSERT INTO candidate_source(workspace_id,candidate_id,source_id) VALUES($1,$2,$3)",
        [w, local.candidate.id, source.messageId],
      ),
    ).rejects.toThrow("foreign key");
  });
  it("rejects stale inference, fences old attempts, and rejects references the model was not given", async () => {
    const { a, w } = await setup();
    const first = await say(a, w);
    const second = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "Il locale costa €3.200 al mese.",
    });
    const claim = await claimInterpretation(second.interpretationId as string);
    expect(claim).not.toBeNull();
    const output = await fixtureInterpreter.interpret(claim!.context);
    await expect(
      publishInterpretation(claim!, {
        ...output,
        proposals: [{ ...output.proposals[0], sourceIds: [randomUUID()] }],
      }),
    ).rejects.toThrow("INVALID_SOURCE_REFERENCE");
    await accept(a, w, first.candidate.id);
    expect(await publishInterpretation(claim!, output)).toBe(false);
    expect(
      (
        await pool.query("SELECT status FROM interpretation WHERE id=$1", [
          second.interpretationId,
        ])
      ).rows[0].status,
    ).toBe("stale");
    await execute(a, w, randomUUID(), {
      type: "interpretation.retry",
      interpretationId: second.interpretationId,
    });
    await processInterpretation(
      second.interpretationId as string,
      fixtureInterpreter,
    );
    expect(await publishInterpretation(claim!, output)).toBe(false);
  });
  it("concurrent acceptance cannot silently overwrite a current reference", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    const one = await say(a, w),
      two = await say(b, w, "Il locale costa €3.500 al mese.");
    const results = await Promise.allSettled([
      accept(a, w, one.candidate.id),
      accept(b, w, two.candidate.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await snapshot(a, w)).versions).toHaveLength(1);
  });
  it("supports explicit named project approvals only; editorial acceptance cannot manufacture commitments", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    const outsider = await user();
    await join(a, outsider, w);
    const n = await say(a, w, "Ci impegniamo a preparare il concept insieme.");
    await expect(accept(a, w, n.candidate.id)).rejects.toThrow(
      "DESCRIPTIVE_CLARIFICATION_REQUIRED",
    );
    const p = await execute(a, w, randomUUID(), {
      type: "commitment.propose",
      candidateId: n.candidate.id,
      people: [a, b],
    });
    let state = await snapshot(a, w);
    const approve = (
      person: string,
      accessRevision = state.workspace.access_revision,
    ) =>
      execute(person, w, randomUUID(), {
        type: "commitment.approve",
        proposalId: p.proposalId,
        expectedContextRevision: state.workspace.context_revision,
        expectedAccessRevision: accessRevision,
        representSelf: true,
      });
    await expect(approve(outsider)).rejects.toThrow("NOT_A_NAMED_APPROVER");
    await approve(a);
    expect((await snapshot(a, w)).commitments[0].adopted_at).toBeNull();
    const oldAccess = state.workspace.access_revision;
    await execute(a, w, randomUUID(), {
      type: "member.remove",
      personId: outsider,
      expectedAccessRevision: oldAccess,
      confirmed: true,
    });
    await expect(approve(b, oldAccess)).rejects.toThrow("AUTHORITY_STALE");
    state = await snapshot(a, w);
    await approve(b);
    expect((await snapshot(a, w)).commitments[0].adopted_at).toBeNull();
    await approve(a);
    expect((await snapshot(a, w)).commitments[0].adopted_at).not.toBeNull();
  });
  it("prevents peer removal races and leaves named joint conditions unchanged on self-exit", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    // An accepted protected arrangement fixture exercises the supported transition boundary.
    // Creating/modifying such arrangements through UI is outside this slice.
    const relationA = (
      await pool.query(
        "SELECT id FROM access_relationship WHERE workspace_id=$1 AND holder_id=$2",
        [w, a],
      )
    ).rows[0].id;
    const relationB = randomUUID();
    await pool.query(
      "UPDATE access_relationship SET protected=true WHERE id=$1",
      [relationA],
    );
    await pool.query(
      "INSERT INTO access_relationship(id,workspace_id,holder_id,invitations,remove_members,change_access,protected,basis) VALUES($1,$2,$3,true,true,true,true,'test_explicit_joint_arrangement')",
      [relationB, w, b],
    );
    for (const r of [relationA, relationB])
      for (const required of [relationA, relationB])
        await pool.query("INSERT INTO access_condition VALUES($1,$2,$3)", [
          w,
          r,
          required,
        ]);
    const state = await snapshot(a, w);
    const remove = (actor: string, target: string) =>
      execute(actor, w, randomUUID(), {
        type: "member.remove",
        personId: target,
        expectedAccessRevision: state.workspace.access_revision,
        confirmed: true,
      });
    const results = await Promise.allSettled([remove(a, b), remove(b, a)]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    await execute(a, w, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    expect(
      (await snapshot(b, w)).access.find((r) => r.holder_id === b),
    ).toMatchObject({ active: true, protected: true });
    expect(
      (
        await pool.query(
          "SELECT * FROM access_condition WHERE workspace_id=$1",
          [w],
        )
      ).rowCount,
    ).toBe(4);
    await execute(b, w, randomUUID(), {
      type: "access.relinquish",
      confirmed: true,
    });
    await say(b, w);
    expect((await snapshot(b, w)).messages).toHaveLength(2);
  });
  it("readmission shows absence-period history but does not restore ended governance or add adherence", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    await execute(b, w, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    await say(a, w, "Il locale costa €3.200 al mese.");
    await join(a, b, w);
    const state = await snapshot(b, w);
    expect(state.messages).toHaveLength(2);
    expect(state.adherences).toHaveLength(0);
    expect(state.access.some((r) => r.holder_id === b && r.active)).toBe(false);
  });
  it("retrieves relevant old sources selectively and defers insufficient context without promotion", async () => {
    const { a, w } = await setup();
    const old = await say(
      a,
      w,
      "Il locale costa €3.000, riferimento contratto GINEPRO.",
    );
    // Put the reference beyond ordinary conversation neighbours so this exercises retrieval,
    // not the newly supported recent conversational context.
    for (let i = 0; i < 24; i++)
      await say(a, w, `Un messaggio non pertinente ${i}.`);
    expect((await retrieveSources(w, ["GINEPRO"])).map((s) => s.id)).toEqual([
      old.messageId,
    ]);
    const other = (await createWorkspace(a, "Other", randomUUID())).id;
    expect(await retrieveSources(other, ["GINEPRO"])).toHaveLength(0);
    const input = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "Confronta GINEPRO.",
    });
    let calls = 0;
    const retriever: Interpreter = {
      async interpret(context) {
        calls++;
        if (!context.sources.some((s) => s.id === old.messageId))
          return { proposals: [], needsMore: ["GINEPRO"] };
        return fixtureInterpreter.interpret(context);
      },
    };
    await processInterpretation(input.interpretationId as string, retriever);
    expect(calls).toBe(2);
    const insufficient = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "Una questione ambigua",
    });
    await expect(
      processInterpretation(insufficient.interpretationId as string, {
        async interpret() {
          return { proposals: [], needsMore: ["missing"] };
        },
      }),
    ).rejects.toThrow("MORE_CONTEXT_REQUIRED");
    expect(
      (
        await pool.query("SELECT 1 FROM candidate WHERE interpretation_id=$1", [
          insufficient.interpretationId,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("recovers expired work after a crash and prevents the original attempt from publishing", async () => {
    const { a, w } = await setup();
    const m = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "Il locale costa €3.000 al mese.",
    });
    const old = await claimInterpretation(m.interpretationId as string);
    expect(old).not.toBeNull();
    await pool.query(
      "UPDATE interpretation SET lease_until=now()-interval '1 second' WHERE id=$1",
      [m.interpretationId],
    );
    await recoverExpiredInterpretations();
    await processInterpretation(
      m.interpretationId as string,
      fixtureInterpreter,
    );
    expect(
      await publishInterpretation(
        old!,
        await fixtureInterpreter.interpret(old!.context),
      ),
    ).toBe(false);
    expect(
      (
        await pool.query("SELECT 1 FROM candidate WHERE interpretation_id=$1", [
          m.interpretationId,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("keeps alternative accounts and their sources available when assembling context", async () => {
    const { a, w } = await setup();
    const first = await say(a, w);
    await accept(a, w, first.candidate.id);
    const alternative = await say(a, w, "Il locale costa €3.500 al mese.");
    const m = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "Quale affitto stiamo usando?",
    });
    const claim = await claimInterpretation(m.interpretationId as string);
    expect(claim!.context.otherAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: alternative.candidate.id }),
      ]),
    );
    expect(claim!.context.sources.map((s) => s.id)).toEqual(
      expect.arrayContaining([first.messageId, alternative.messageId]),
    );
  });
});
