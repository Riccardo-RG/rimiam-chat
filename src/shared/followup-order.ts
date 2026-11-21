import type { FollowupItem } from "../contracts/tasks.ts";

export const reminderTime = (f: FollowupItem) =>
  f.recurrence ? f.nextRemindAt : f.remindAt;
export function sortedReminders(rows: readonly FollowupItem[]) {
  const time = (f: FollowupItem) => {
    const at = reminderTime(f);
    return at ? Date.parse(at) : Number.POSITIVE_INFINITY;
  };
  return [...rows].sort(
    (a, b) =>
      Number(b.status === "active") - Number(a.status === "active") ||
      Number(b.needsReview) - Number(a.needsReview) ||
      time(a) - time(b),
  );
}

export function reminderState(f: FollowupItem) {
  if (f.status === "done") return "Concluso";
  if (f.status === "cancelled") return "Annullato";
  if (f.needsReview) return "Da rivedere";
  if (f.recurrence) return f.nextRemindAt ? "Programmato" : "Serie terminata";
  return f.deliveredAt ? "Promemoria scattato" : "Programmato";
}
