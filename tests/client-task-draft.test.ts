import { expect, it } from "vitest";
import { taskDraft } from "../src/client/task-draft";
import {
  taskCommandSchema,
  type TaskItem,
  type FollowupItem,
} from "../src/contracts/tasks";
import {
  describeRepeat,
  once,
  reminderState,
  repeatDraft,
  repeatRule,
} from "../src/client/reminder-repeat";

it("a current Task projection can open an editable form and submit through the strict command boundary", () => {
  const task: TaskItem = {
    id: "33333333-3333-4333-8333-333333333333",
    version: 3,
    title: "Preparare la prima beta",
    description: "Confrontare il flusso di invito",
    dueAt: "2026-09-18T12:00:00Z",
    timeZone: "Europe/Rome",
    suggestedPerson: "giulia",
    references: [
      {
        kind: "message",
        id: "44444444-4444-4444-8444-444444444444",
        version: 1,
      },
    ],
    status: "in_progress",
    actor: "riccardo",
    createdAt: "2026-09-14T12:00:00Z",
    reason: "Preparazione",
    candidateId: null,
    responsible: "giulia",
    acceptedVersion: 3,
    responsibleAvailable: true,
  };
  const form = taskDraft(task);
  form.description =
    "Provare l’ingresso di due persone e conservare le osservazioni.";
  const command = taskCommandSchema.parse({
    type: "task.propose_revision",
    taskId: task.id,
    expectedVersion: task.version,
    reason: "Perimetro da rivalutare",
    content: form,
  });
  expect(command.type).toBe("task.propose_revision");
  expect(form.references).toEqual(task.references);
  expect(form.dueAt).toEqual(task.dueAt);
  expect(form).not.toHaveProperty("responsible");
  expect(task.description).toBe("Confrontare il flusso di invito");
});

it("edits one-off, daily and selected-day rules without changing their meaning", () => {
  expect(repeatRule(repeatDraft(undefined))).toBeNull();
  const weekly = { weekdays: [1, 4], until: "2027-03-29" };
  expect(repeatRule(repeatDraft(weekly))).toEqual(weekly);
  expect(repeatRule({ ...repeatDraft(weekly), mode: "once" })).toBeNull();
  expect(repeatRule({ ...once, mode: "daily" })).toEqual({
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  expect(repeatDraft({ weekdays: [1, 2, 3, 4, 5, 6, 7] }).mode).toBe("daily");
});

it("describes the saved wall clock and inclusive end independently of the device zone", () => {
  const follow: FollowupItem = {
    id: "33333333-3333-4333-8333-333333333333",
    version: 1,
    owner: "member",
    content: "Rivedere il diario",
    kind: "review",
    status: "active",
    reason: "Preparazione",
    reference: null,
    needsReview: false,
    createdAt: "2027-01-01T09:00:00Z",
    deliveredAt: "2027-03-25T09:00:00Z",
    remindAt: "2027-03-25T09:00:00Z",
    timeZone: "Europe/Rome",
    recurrence: { weekdays: [1, 4], until: "2027-03-29" },
    nextRemindAt: "2027-03-29T08:00:00Z",
  };
  expect(describeRepeat(follow)).toBe(
    "Lunedì, Giovedì alle 10:00 (Europe/Rome) · Fino al 29/03/2027 incluso",
  );
  expect(reminderState(follow)).toBe("Programmato");
  expect(reminderState({ ...follow, recurrence: null })).toBe(
    "Promemoria scattato",
  );
  expect(reminderState({ ...follow, nextRemindAt: null })).toBe(
    "Serie terminata",
  );
  expect(reminderState({ ...follow, needsReview: true })).toBe("Da rivedere");
  expect(reminderState({ ...follow, status: "cancelled" })).toBe("Annullato");
});
