import assert from "node:assert/strict";
import test from "node:test";
import {
  taskCommandSchema,
  type TaskItem,
  type FollowupItem,
  type TasksView,
} from "../../src/contracts/tasks.ts";
import {
  revisionCommand,
  adoptionCommand,
  nextOccurrence,
  changeOccurrence,
} from "../src/workspace/schedule-actions.ts";

const taskId = "a4cef8f2-b0de-4c0c-9ae8-b01c12fcc04d",
  id = "b2b1a726-4d38-4ab1-831f-9fc76d960d44",
  fixed = "2026-11-20T10:00:00.000Z",
  next = "2026-11-23T10:00:00.000Z";
const content = {
  title: "Inviare un preventivo",
  description: "Controllare le voci",
  dueAt: fixed,
  timeZone: "Europe/Rome",
  suggestedPerson: "matteo",
  references: [{ kind: "source" as const, id, version: 2 }],
};
const task: TaskItem = {
  ...content,
  id: taskId,
  version: 3,
  status: "in_progress",
  actor: "riccardo",
  createdAt: fixed,
  reason: "Accettato",
  candidateId: null,
  responsible: "matteo",
  acceptedVersion: 2,
  responsibleAvailable: true,
};
const proposal: TasksView["proposals"][number] = {
  id,
  taskId,
  baseVersion: 3,
  actor: "giulia",
  createdAt: fixed,
  reason: "Nuova data",
  content: { ...content, dueAt: next },
};
const reminder: FollowupItem = {
  id,
  version: 3,
  owner: "riccardo",
  status: "active",
  kind: "remember",
  content: "Incontro",
  remindAt: fixed,
  timeZone: "Europe/Rome",
  reference: null,
  recurrence: { weekdays: [1, 2, 3, 4, 5] },
  createdAt: fixed,
  reason: "Creato",
  needsReview: false,
  deliveredAt: fixed,
  nextRemindAt: next,
};
test("native material revision preserves exact references, binds the current version and requests fresh responsibility", () => {
  const revised = revisionCommand(task, proposal.content, "Nuova data");
  assert.deepEqual(taskCommandSchema.parse(revised), {
    type: "task.propose_revision",
    taskId,
    expectedVersion: 3,
    content: proposal.content,
    reason: "Nuova data",
  });
  assert.equal(
    revisionCommand(
      { ...task, responsible: null },
      proposal.content,
      "Aggiorna",
    )?.type,
    "task.revise",
  );
  assert.equal(
    revisionCommand(
      { ...task, status: "completed" },
      proposal.content,
      "Richiesta",
    ),
    null,
  );
  assert.deepEqual(
    taskCommandSchema.parse(adoptionCommand(task, proposal, "matteo")),
    {
      type: "task.adopt_revision",
      taskId,
      expectedVersion: 3,
      proposalId: id,
      acceptResponsibility: true,
      reason: "Accettazione personale della revisione proposta",
    },
  );
  for (const rejected of [
    adoptionCommand(task, proposal, "riccardo"),
    adoptionCommand(
      { ...task, responsibleAvailable: false },
      proposal,
      "matteo",
    ),
    adoptionCommand({ ...task, status: "cancelled" }, proposal, "matteo"),
    adoptionCommand({ ...task, version: 4 }, proposal, "matteo"),
    adoptionCommand(task, { ...proposal, taskId: id }, "matteo"),
  ])
    assert.equal(rejected, null);
});
test("occurrence changes use the actual next instant, default to a single day and preserve creator and series bounds", () => {
  const updated = new Date("2026-11-23T11:00:00.000Z"),
    now = Date.parse(fixed);
  const change = (
    f: FollowupItem,
    actor = "riccardo",
    following = false,
    when = updated,
  ) =>
    changeOccurrence(
      f,
      actor,
      following,
      " Nuovo incontro ",
      when,
      "Europe/Rome",
      now,
    );
  const expect = {
    type: "followup.occurrence",
    followupId: id,
    expectedVersion: 3,
    scheduledAt: next,
    action: "replace",
    replacement: {
      content: "Nuovo incontro",
      remindAt: updated.toISOString(),
      timeZone: "Europe/Rome",
    },
  };
  assert.deepEqual(taskCommandSchema.parse(change(reminder)), expect);
  assert.deepEqual(
    taskCommandSchema.parse(change(reminder, "riccardo", true)),
    { ...expect, action: "replace_following" },
  );
  assert.equal(change(reminder, "matteo"), null);
  assert.equal(change({ ...reminder, status: "done" }), null);
  assert.equal(
    change({ ...reminder, recurrence: null }, "riccardo", true),
    null,
  );
  assert.equal(change(reminder, "riccardo", false, new Date(fixed)), null);
  assert.equal(nextOccurrence({ ...reminder, nextRemindAt: null }), null);
  assert.equal(
    nextOccurrence({ ...reminder, nextRemindAt: null, recurrence: null }),
    null,
  );
});
