import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { accessView } from "../src/server/access-queries";
import { snapshot } from "../src/server/queries";

async function person() {
  const email = `${randomUUID()}@example.test`,
    password = "Access-test-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Access tester" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
  ).rows[0].id as string;
  return { id: user.id, email, session };
}
type Person = Awaited<ReturnType<typeof person>>;
async function setup(count = 2) {
  const people: Person[] = [];
  for (let i = 0; i < count; i++) people.push(await person());
  const [a, b, c] = people;
  const w = (await createWorkspace(a.id, "Access governance", randomUUID())).id;
  const command = (input: unknown, as = a, key = randomUUID()) =>
    execute(as.id, w, key, input, as.session);
  for (const p of people.slice(1)) {
    const invite = await command({
      type: "invitation.create",
      email: p.email,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(p.id, String(invite.token), true);
  }
  const view = (as = a) => accessView(as.id, w);
  const propose = async (change: unknown, as = a) =>
    command(
      {
        type: "access.propose",
        expectedAccessRevision: (await view(as)).accessRevision,
        change,
        reason: "Accordo esplicito per questo Workspace",
      },
      as,
    );
  const approve = async (
    proposal: string,
    role: "authority" | "holder",
    as = a,
    key = randomUUID(),
  ) =>
    command(
      {
        type: "access.approve",
        proposalId: proposal,
        expectedAccessRevision: (await view(as)).accessRevision,
        role,
        acceptTerms: true,
      },
      as,
      key,
    );
  const adopt = async (change: unknown, as = a) => {
    const { proposalId } = await propose(change, as);
    const proposal = (await view(as)).proposals.find(
      (p) => p.id === proposalId,
    )!;
    for (const r of proposal.required)
      await approve(
        proposal.id,
        r.role,
        people.find((p) => p.id === r.personId)!,
      );
    return proposal.id;
  };
  return { a, b, c, w, people, command, view, propose, approve, adopt };
}
afterAll(() => pool.end());

describe("Explicit access arrangements", () => {
  it("creates protected peers only after pre-transition authorization and separate holder acceptance", async () => {
    const { a, b, w, propose, approve, view, command } = await setup();
    const { proposalId } = await propose({
      kind: "stewardship",
      people: [a.id, b.id],
    });
    await approve(String(proposalId), "authority");
    await approve(String(proposalId), "holder");
    await expect(
      command(
        {
          type: "invitation.create",
          email: "later@example.test",
          fullHistoryDisclosed: true,
        },
        b,
      ),
    ).rejects.toThrow("ACCESS_AUTHORITY_REQUIRED");
    expect(await approve(String(proposalId), "holder", b)).toMatchObject({
      adopted: true,
    });
    const state = await view();
    expect(state.relationships.filter((r) => r.active)).toHaveLength(2);
    for (const r of state.relationships) {
      expect(r.protected).toBe(true);
      expect(r.conditions).toHaveLength(2);
      expect(r.conditions.every((c) => c.available)).toBe(true);
    }
    expect(state.proposals[0].terms.join(" ")).toContain("nessuna successione");
    expect((await snapshot(a.id, w)).adherences).toHaveLength(0);
    expect((await snapshot(a.id, w)).commitments).toHaveLength(0);
  });
  it("does not let either peer win removal or demotion by clicking first", async () => {
    const { a, b, command, view, adopt, propose, approve } = await setup();
    await adopt({ kind: "stewardship", people: [a.id, b.id] });
    const revision = (await view()).accessRevision;
    const outcomes = await Promise.allSettled([
      command({
        type: "member.remove",
        personId: b.id,
        expectedAccessRevision: revision,
        confirmed: true,
      }),
      command(
        {
          type: "member.remove",
          personId: a.id,
          expectedAccessRevision: revision,
          confirmed: true,
        },
        b,
      ),
    ]);
    expect(outcomes.every((o) => o.status === "rejected")).toBe(true);
    const bRelation = (await view()).relationships.find(
      (r) => r.holderId === b.id,
    )!;
    await expect(
      propose({ kind: "revoke", relationshipId: bRelation.id }),
    ).rejects.toThrow("PROTECTED_CHANGE_REQUIRES_ARRANGEMENT");
    const { proposalId } = await propose({
      kind: "stewardship",
      people: [a.id],
    });
    await approve(String(proposalId), "authority");
    await approve(String(proposalId), "holder");
    expect(
      (await view()).relationships.find((r) => r.id === bRelation.id)?.active,
    ).toBe(true);
    await approve(String(proposalId), "authority", b);
    expect(
      (await view()).relationships.find((r) => r.id === bRelation.id)?.active,
    ).toBe(false);
  });
  it("transfers ordinary stewardship without residual creator powers and invalidates unaccepted succession after departure", async () => {
    const first = await setup();
    await first.adopt({ kind: "stewardship", people: [first.b.id] });
    await expect(
      first.propose({ kind: "stewardship", people: [first.a.id] }),
    ).rejects.toThrow("ACCESS_CHANGE_AUTHORITY_REQUIRED");
    await first.command({ type: "member.leave", confirmed: true });
    expect(
      (await first.view(first.b)).relationships.find(
        (r) => r.holderId === first.b.id,
      )?.available,
    ).toBe(true);
    const second = await setup();
    const { proposalId } = await second.propose({
      kind: "stewardship",
      people: [second.b.id],
    });
    await second.approve(String(proposalId), "authority");
    await second.command({ type: "member.leave", confirmed: true });
    await expect(
      second.approve(String(proposalId), "holder", second.b),
    ).rejects.toThrow("ACCESS_PROPOSAL_STALE");
    expect(
      (await second.view(second.b)).relationships.some((r) => r.active),
    ).toBe(false);
  });
  it("bounds delegation to invitations with reserved revocation, no onward delegation and no removal protection", async () => {
    const { a, b, command, view, adopt, propose, w } = await setup();
    await adopt({ kind: "delegation", personId: b.id });
    const delegate = (await view()).relationships.find(
      (r) => r.holderId === b.id,
    )!;
    expect(delegate).toMatchObject({
      protected: false,
      kind: "invitation_delegate",
      invitations: true,
      changeAccess: false,
      removeMembers: false,
    });
    await expect(
      propose({ kind: "stewardship", people: [b.id] }, b),
    ).rejects.toThrow("ACCESS_CHANGE_AUTHORITY_REQUIRED");
    const newcomer = await person();
    const invite = await command(
      {
        type: "invitation.create",
        email: newcomer.email,
        fullHistoryDisclosed: true,
      },
      b,
    );
    await adopt({ kind: "revoke", relationshipId: delegate.id });
    await expect(
      acceptInvitation(newcomer.id, String(invite.token), true),
    ).rejects.toThrow("ACCESS_AUTHORITY_REQUIRED");
    expect(
      (await snapshot(a.id, w)).members.find((m) => m.user_id === b.id)?.active,
    ).toBe(true);
    await adopt({ kind: "delegation", personId: b.id });
    await command({
      type: "member.remove",
      personId: b.id,
      expectedAccessRevision: (await view()).accessRevision,
      confirmed: true,
    });
    await expect(view(b)).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  });
  it("preserves binding three-person conditions after voluntary relinquishment without blocking ordinary participation", async () => {
    const { a, b, c, adopt, command, view, propose } = await setup(3);
    await adopt({ kind: "stewardship", people: [a.id, b.id, c.id] });
    const previous = await view();
    const aConditions = previous.relationships.find(
      (r) => r.holderId === a.id,
    )!.conditions;
    await command({ type: "access.relinquish", confirmed: true }, b);
    const current = await view();
    expect(
      current.relationships
        .find((r) => r.holderId === a.id)!
        .conditions.map((c) => c.participationId),
    ).toEqual(aConditions.map((c) => c.participationId));
    expect(
      current.relationships
        .find((r) => r.holderId === a.id)!
        .conditions.some((c) => !c.available),
    ).toBe(true);
    await expect(
      propose({ kind: "stewardship", people: [a.id, c.id] }),
    ).rejects.toThrow("ACCESS_CONDITIONS_UNAVAILABLE");
    await command(
      {
        type: "message.send",
        content: "La collaborazione continua senza nuova governance.",
      },
      b,
    );
    const delegated = await propose({ kind: "delegation", personId: b.id });
    expect(delegated.proposalId).toBeTruthy();
  });
  it("does not use account security ineligibility to remove protected authority and checks authenticated acts", async () => {
    const { a, b, w, adopt, propose, command, view } = await setup();
    await adopt({ kind: "stewardship", people: [a.id, b.id] });
    await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [b.id]);
    await expect(
      propose({ kind: "stewardship", people: [a.id] }),
    ).rejects.toThrow("ACCESS_CONDITIONS_UNAVAILABLE");
    expect(
      (await view()).relationships.find((r) => r.holderId === b.id),
    ).toMatchObject({ active: true, protected: true, available: false });
    await expect(
      execute(a.id, w, randomUUID(), {
        type: "access.propose",
        expectedAccessRevision: (await view()).accessRevision,
        change: { kind: "stewardship", people: [a.id] },
        reason: "No session",
      }),
    ).rejects.toThrow("AUTHENTICATED_SESSION_REQUIRED");
    await pool.query('UPDATE "user" SET eligible=true WHERE id=$1', [b.id]);
    await command({ type: "access.relinquish", confirmed: true }, b);
  });
  it("fences concurrent incompatible proposals, preserves receipt idempotency and immutable history", async () => {
    const { a, b, c, propose, approve, view, command, w } = await setup(3);
    const one = String(
      (await propose({ kind: "stewardship", people: [b.id] })).proposalId,
    );
    const two = String(
      (await propose({ kind: "stewardship", people: [c.id] })).proposalId,
    );
    await approve(one, "authority");
    await approve(two, "authority");
    const revision = (await view()).accessRevision,
      key = randomUUID();
    const act = {
      type: "access.approve",
      proposalId: one,
      expectedAccessRevision: revision,
      role: "holder",
      acceptTerms: true,
    };
    const result = await command(act, b, key);
    expect(await command(act, b, key)).toEqual(result);
    await expect(approve(two, "holder", c)).rejects.toThrow(
      "ACCESS_PROPOSAL_STALE",
    );
    expect((await view()).proposals.find((p) => p.id === two)?.status).toBe(
      "stale",
    );
    await expect(
      pool.query(
        "UPDATE access_proposal SET reason='rewritten' WHERE workspace_id=$1",
        [w],
      ),
    ).rejects.toThrow("immutable historical record");
    const foreign = await setup();
    await expect(
      foreign.command({
        type: "access.approve",
        proposalId: one,
        expectedAccessRevision: (await foreign.view()).accessRevision,
        role: "authority",
        acceptTerms: true,
      }),
    ).rejects.toThrow("ACCESS_PROPOSAL_NOT_FOUND");
    expect(
      (await view()).relationships.find((r) => r.holderId === a.id)?.active,
    ).toBe(false);
  });
});
