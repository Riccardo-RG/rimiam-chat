import { expect, it } from "vitest";
import { taskDraft } from "../src/client/task-draft";
import { taskCommandSchema, type TaskItem } from "../src/contracts/tasks";

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
