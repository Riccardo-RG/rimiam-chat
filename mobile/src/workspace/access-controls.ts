import type { AccessView } from "../../../src/contracts/access";
type Relationship = Pick<
  AccessView["relationships"][number],
  | "active"
  | "holderId"
  | "protected"
  | "kind"
  | "available"
  | "removeMembers"
  | "changeAccess"
>;

export function canProposeAccess(relationships: Relationship[], actor: string) {
  return relationships.some(
    (r) =>
      r.active &&
      r.available &&
      r.holderId === actor &&
      r.kind === "stewardship" &&
      r.changeAccess,
  );
}
export function canRemoveMember(
  relationships: Relationship[],
  actor: string,
  member: string,
) {
  if (
    actor === member ||
    !relationships.some(
      (r) => r.active && r.available && r.holderId === actor && r.removeMembers,
    )
  )
    return false;
  return !relationships.some(
    (r) =>
      r.active &&
      r.holderId === member &&
      (r.protected || r.kind === "stewardship"),
  );
}
export function accessEffects(
  proposal: Pick<AccessView["proposals"][number], "targets">,
  name: (id: string) => string,
) {
  return proposal.targets.map((t) => {
    const role = t.kind === "stewardship" ? "gestione accessi" : "inviti";
    const action = t.active
      ? t.baseVersion
        ? "Aggiorna"
        : "Assegna"
      : "Termina";
    return (
      action +
      " " +
      role +
      " · " +
      name(t.holderId) +
      (t.active && t.protected ? " · accordo protetto" : "")
    );
  });
}
