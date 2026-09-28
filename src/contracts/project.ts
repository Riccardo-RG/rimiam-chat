import { conversationOriginSchema } from "./conversation-handoff.ts";
import { z } from "zod";
const version = z.number().int().positive();
const revision = z.number().int().nonnegative();
const content = z.string().trim().min(1).max(12000);
const reason = z.string().trim().min(1).max(4000);
const person = z.string().min(1);
const scope = z
  .object({ kind: z.enum(["goal", "act"]), id: z.uuid(), version })
  .strict();
const capability = z.enum([
  "goal.change",
  "goal.conclude",
  "goal.subgoal",
  "act.create",
  "act.replace",
  "act.revoke",
]);
const approval = {
  expectedAccessRevision: revision,
  representedPersonId: person,
  mandateId: z.uuid().optional(),
  confirmExactContent: z.literal(true),
};
export const projectCommandSchemas = [
  z
    .object({
      type: z.literal("mandate.offer"),
      holderId: person,
      scope,
      capability,
      expiresAt: z.iso.datetime({ offset: true }).nullable(),
      reason,
      representSelf: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("mandate.respond"),
      mandateId: z.uuid(),
      expectedVersion: version,
      response: z.enum([
        "accept",
        "decline",
        "contest",
        "confirm",
        "revoke",
        "relinquish",
      ]),
      reason,
    })
    .strict(),
  z
    .object({
      type: z.literal("goal.propose"),
      conversationOrigin: conversationOriginSchema.optional(),
      goalId: z.uuid(),
      expectedVersion: version,
      mode: z.enum(["revise", "replace", "subgoal", "complete", "abandon"]),
      content,
      reason,
      previousBecomesSubgoal: z.boolean().default(false),
      affectedPeople: z.array(person).max(20).default([]),
      blockingActIds: z.array(z.uuid()).max(100).default([]),
      preserveExistingObligations: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("goal.approve"),
      transitionId: z.uuid(),
      ...approval,
    })
    .strict(),
  z
    .object({
      type: z.literal("project.propose"),
      conversationOrigin: conversationOriginSchema.optional(),
      kind: z.enum(["decision", "constraint", "commitment"]),
      content,
      people: z.array(person).min(1).max(20),
      goal: z.object({ id: z.uuid(), version }).strict().nullable(),
      operation: z
        .enum(["establish", "replace", "revoke"])
        .default("establish"),
      replacesActId: z.uuid().optional(),
      reason,
    })
    .strict(),
  z
    .object({
      type: z.literal("project.approve"),
      proposalId: z.uuid(),
      ...approval,
    })
    .strict(),
] as const;
export const projectCommandSchema = z.discriminatedUnion(
  "type",
  projectCommandSchemas,
);
export type ProjectCommand = z.infer<typeof projectCommandSchema>;

const approvalRecord = z.object({
  personId: person,
  actorId: person,
  mandateId: z.uuid().nullable(),
  mandateVersion: version.nullable(),
  createdAt: z.string(),
});
export const projectViewSchema = z.object({
  accessRevision: revision,
  members: z.array(
    z.object({
      id: person,
      name: z.string(),
      active: z.boolean(),
      eligible: z.boolean(),
    }),
  ),
  goals: z.array(
    z.object({
      id: z.uuid(),
      version,
      content: z.string(),
      currentPrimary: z.boolean(),
      status: z.enum(["active", "completed", "abandoned", "replaced"]),
      parentGoalId: z.uuid().nullable(),
      parentGoalVersion: version.nullable(),
      participants: z.array(person),
      adherences: z.array(z.object({ personId: person, version })),
      versions: z.array(
        z.object({
          version,
          content: z.string(),
          actor: person,
          sourceId: z.uuid().nullable(),
          reason: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
  ),
  goalProposals: z.array(
    z.object({
      id: z.uuid(),
      goalId: z.uuid(),
      goalVersion: version,
      mode: z.enum(["revise", "replace", "subgoal", "complete", "abandon"]),
      content: z.string(),
      reason: z.string(),
      actor: person,
      sourceId: z.uuid(),
      previousBecomesSubgoal: z.boolean(),
      people: z.array(person),
      obligations: z.array(
        z.object({ actId: z.uuid(), blocking: z.boolean() }),
      ),
      status: z.enum(["pending", "blocked", "stale", "adopted"]),
      approvals: z.array(approvalRecord),
      createdAt: z.string(),
    }),
  ),
  mandates: z.array(
    z.object({
      id: z.uuid(),
      version,
      grantorId: person,
      holderId: person,
      scope,
      capability,
      status: z.enum([
        "offered",
        "accepted",
        "contested",
        "revoked",
        "declined",
        "relinquished",
      ]),
      expiresAt: z.string().nullable(),
      available: z.boolean(),
      reason: z.string(),
      sourceId: z.uuid(),
      terms: z.string(),
      versions: z.array(
        z.object({
          version,
          status: z.string(),
          actor: person,
          reason: z.string(),
          sourceId: z.uuid(),
          createdAt: z.string(),
        }),
      ),
    }),
  ),
  acts: z.array(
    z.object({
      proposalId: z.uuid(),
      actId: z.uuid().nullable(),
      kind: z.enum(["decision", "constraint", "commitment"]),
      content: z.string(),
      operation: z.enum(["establish", "replace", "revoke"]),
      replacesActId: z.uuid().nullable(),
      sourceId: z.uuid().nullable(),
      candidateId: z.uuid().nullable(),
      goalId: z.uuid().nullable(),
      goalVersion: version.nullable(),
      people: z.array(person),
      status: z.enum(["proposed", "effective", "superseded"]),
      approvals: z.array(approvalRecord),
      createdAt: z.string(),
    }),
  ),
  relations: z.array(
    z.object({
      id: z.uuid(),
      fromGoalId: z.uuid(),
      fromVersion: version,
      toGoalId: z.uuid(),
      toVersion: version,
      kind: z.enum(["replaces", "subgoal"]),
      transitionId: z.uuid(),
    }),
  ),
});
export type ProjectView = z.infer<typeof projectViewSchema>;
