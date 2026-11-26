import type { TaskItem } from "../contracts/tasks";

export function pendingOffer(task: TaskItem) {
  return (
    !!task.suggestedPerson &&
    !task.responsible &&
    !task.declinedBy &&
    task.status !== "completed" &&
    task.status !== "cancelled"
  );
}

export function assignmentLabel(
  task: TaskItem,
  actor: string,
  name: (id: string) => string,
  t: (text: string, ...values: string[]) => string,
) {
  if (task.responsible) {
    if (!task.responsibleAvailable)
      return t("{0} · accesso cessato", name(task.responsible));
    return task.responsible === actor
      ? t("Te ne occupi tu")
      : name(task.responsible);
  }
  if (task.declinedBy) return t("Proposta rifiutata");
  if (pendingOffer(task) && task.suggestedPerson)
    return task.suggestedPerson === actor
      ? t("In attesa di te")
      : t("In attesa di {0}", name(task.suggestedPerson));
  return t("Non assegnata");
}

// The API pages tasks and reminders together. Sort only the visible task page.
export function orderSpaceTasks(tasks: TaskItem[], actor: string) {
  const pendingForMe = (task: TaskItem) =>
    pendingOffer(task) && task.suggestedPerson === actor;
  const closed = (task: TaskItem) =>
    ["completed", "cancelled"].includes(task.status);
  const due = (task: TaskItem) =>
    task.dueAt ? Date.parse(task.dueAt) : Infinity;
  return [...tasks].sort(
    (a, b) =>
      Number(pendingForMe(b)) - Number(pendingForMe(a)) ||
      Number(closed(a)) - Number(closed(b)) ||
      due(a) - due(b) ||
      b.createdAt.localeCompare(a.createdAt),
  );
}
