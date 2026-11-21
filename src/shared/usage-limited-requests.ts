import { assistantRequestFailures } from "./assistant-request-failures";

export function usageLimitedRequests(
  ...input: Parameters<typeof assistantRequestFailures>
) {
  const limited = new Map<string, string>();
  for (const [messageId, failure] of assistantRequestFailures(...input)) {
    if (failure.reason === "usage")
      limited.set(messageId, failure.interpretationId);
  }
  return limited;
}
