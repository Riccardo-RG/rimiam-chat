import type { TaskContent, TaskItem } from "../contracts/tasks";

/** Copy editable content only; projection/status/authority fields are never command content. */
export function taskDraft(task: TaskItem): TaskContent {
  return {
    title: task.title,
    description: task.description,
    dueAt: task.dueAt,
    timeZone: task.timeZone,
    suggestedPerson: task.suggestedPerson,
    references: task.references,
  };
}
