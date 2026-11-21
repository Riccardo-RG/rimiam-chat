type Message = {
  id: string;
  content: string;
  actor_kind: string;
  reply_to_source_id: string | null;
};
type Status = {
  sourceId: string;
  interpretationStatus: string | null;
  errorCode: string | null;
};
/** Only the response to this device's explicit, confirmed voice turn can be auto-spoken. */
export function voiceReply(
  sourceId: string,
  messages: readonly Message[],
  statuses: readonly Status[],
) {
  const reply = messages.find(
    (m) => m.actor_kind === "miriam" && m.reply_to_source_id === sourceId,
  );
  if (reply)
    return { kind: "ready" as const, id: reply.id, text: reply.content };
  const status = statuses.find((s) => s.sourceId === sourceId);
  if (
    status &&
    (status.errorCode ||
      status.interpretationStatus === "failed" ||
      status.interpretationStatus === "stale")
  )
    return { kind: "failed" as const };
  return { kind: "waiting" as const };
}
