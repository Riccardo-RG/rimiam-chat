import type {
  FollowupItem,
  TaskItem,
  TaskContent,
  TasksView,
  TaskCommand,
} from "../../../src/contracts/tasks";

type Proposal = TasksView["proposals"][number];
export type ScheduleSubmit = (
  label: string,
  command: TaskCommand,
) => Promise<boolean>;
export function revisionCommand(
  t: TaskItem,
  content: TaskContent,
  reason: string,
): TaskCommand | null {
  if (
    t.status === "completed" ||
    t.status === "cancelled" ||
    !content.title.trim() ||
    !reason.trim()
  )
    return null;
  return {
    type: t.responsible ? "task.propose_revision" : "task.revise",
    taskId: t.id,
    expectedVersion: t.version,
    content,
    reason: reason.trim(),
  };
}
export function adoptionCommand(
  t: TaskItem,
  p: Proposal,
  actor: string,
): TaskCommand | null {
  if (
    t.status === "completed" ||
    t.status === "cancelled" ||
    !t.responsibleAvailable ||
    t.responsible !== actor ||
    p.taskId !== t.id ||
    p.baseVersion !== t.version
  )
    return null;
  return {
    type: "task.adopt_revision",
    taskId: t.id,
    expectedVersion: t.version,
    proposalId: p.id,
    acceptResponsibility: true,
    reason: "Accettazione personale della revisione proposta",
  };
}
// Older deliveries are presented separately by Agenda with their original version and instant.
export function nextOccurrence(f: FollowupItem) {
  return f.nextRemindAt ?? null;
}
export function changeOccurrence(
  f: FollowupItem,
  actor: string,
  following: boolean,
  content: string,
  remindAt: Date,
  zone: string,
  now = Date.now(),
): TaskCommand | null {
  const at = nextOccurrence(f);
  if (
    !at ||
    f.owner !== actor ||
    f.status !== "active" ||
    (following && !f.recurrence) ||
    !content.trim() ||
    !Number.isFinite(+remindAt) ||
    +remindAt <= now
  )
    return null;
  return {
    type: "followup.occurrence",
    followupId: f.id,
    expectedVersion: f.version,
    scheduledAt: at,
    action: following ? "replace_following" : "replace",
    replacement: {
      content: content.trim(),
      remindAt: remindAt.toISOString(),
      timeZone: zone,
    },
  };
}
