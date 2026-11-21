import type { MessagePage } from "../contracts/v1";
import type { Snapshot } from "../contracts/web-snapshot";
export function timelineMessage(
  m: MessagePage["messages"][number],
): Snapshot["messages"][number] {
  return {
    id: m.id,
    sequence: m.sequence,
    content: m.content,
    author_id: m.authorId,
    actor_kind: m.actorKind,
    author_name: m.authorName,
    purpose: m.purpose,
    created_at: m.createdAt,
    citation_source_ids: m.citationSourceIds,
    reply_to_source_id: m.replyToSourceId,
    quoteMessageId: m.quoteMessageId,
    workstream_focus: m.workstreamFocus ?? null,
    reference: m.reference ?? null,
    assistanceContext: m.assistanceContext ?? null,
    operationResult: m.operationResult ?? null,
    taskOffer: m.taskOffer ?? null,
    reminder: m.reminder ?? null,
  };
}
