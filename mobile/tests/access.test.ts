import assert from "node:assert/strict";
import test from "node:test";
import {
  accessEffects,
  canProposeAccess,
  canRemoveMember,
} from "../src/workspace/access-controls.ts";
const manager = {
  kind: "stewardship" as const,
  holderId: "a",
  active: true,
  protected: true,
  changeAccess: true,
  removeMembers: true,
  available: true,
};
const invites = {
  kind: "invitation_delegate" as const,
  holderId: "b",
  active: true,
  protected: false,
  changeAccess: false,
  removeMembers: false,
  available: true,
};
test("only current stewards propose; membership removal observes the target protection of the server", () => {
  const rs = [manager, invites];
  assert.equal(canProposeAccess(rs, "b"), false);
  assert.equal(canProposeAccess(rs, "a"), true);
  assert.equal(
    canProposeAccess([{ ...manager, available: false }], "a"),
    false,
  );
  assert.equal(canRemoveMember(rs, "a", "b"), true);
  assert.equal(canRemoveMember(rs, "a", "a"), false);
  assert.equal(canRemoveMember(rs, "b", "c"), false);
  assert.equal(
    canRemoveMember([manager, { ...invites, protected: true }], "a", "b"),
    false,
  );
  assert.equal(
    canRemoveMember(
      [manager, { ...manager, holderId: "c", protected: false }],
      "a",
      "c",
    ),
    false,
  );
});
test("approval review shows both the person leaving and the person receiving the authority", () => {
  const base = {
    relationshipId: "id",
    baseVersion: 2,
    kind: "stewardship" as const,
    protected: true,
  };
  assert.deepEqual(
    accessEffects(
      {
        targets: [
          { ...base, holderId: "A", active: false },
          { ...base, holderId: "B", baseVersion: 0, active: true },
        ],
      },
      (x) => x,
    ),
    [
      "Termina gestione accessi · A",
      "Assegna gestione accessi · B · accordo protetto",
    ],
  );
});
