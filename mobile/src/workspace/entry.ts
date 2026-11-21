/** Message rows are in chronological order. A null target means the bottom of the inverted list. */
export function initialConversationTarget(
  messages: readonly { id: string }[],
  unreadMentionIds: readonly string[],
  explicit?: string,
): string | null {
  if (explicit && messages.some((m) => m.id === explicit)) return explicit;
  const mentions = new Set(unreadMentionIds);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (mentions.has(messages[i].id)) return messages[i].id;
  }
  return null;
}

/** Skip intermediate virtualized-list viewports while seeking a requested message. */
export function settledVisibleIds(
  ids: readonly string[],
  target: string | null,
) {
  return !target || ids.includes(target) ? ids : [];
}

/** Admission notes have no read state; attach them at their actual position in the message history. */
export function joinsByFollowingMessage<T extends { created_at: string }>(
  messages: readonly { id: string; created_at: string }[],
  joins: readonly T[],
) {
  const result = new Map<string, T[]>(),
    ordered = [...joins].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );
  let cursor = 0;
  for (const m of messages) {
    const boundary = Date.parse(m.created_at),
      group: T[] = [];
    while (
      cursor < ordered.length &&
      Date.parse(ordered[cursor].created_at) <= boundary
    )
      group.push(ordered[cursor++]);
    if (group.length) result.set(m.id, group);
  }
  if (cursor < ordered.length) result.set("", ordered.slice(cursor));
  return result;
}
