import type { Snapshot } from "../contracts/web-snapshot";
import { isAssistantAddress, potentiallyHumanAddress } from "./miriam-address";

type RequestMessage = Pick<
  Snapshot["messages"][number],
  | "id"
  | "actor_kind"
  | "content"
  | "purpose"
  | "assistanceContext"
  | "reply_to_source_id"
>;

export type AssistantRequestFailure = {
  interpretationId: string;
  displayName: string;
  reason: "usage" | "unconfigured" | "unavailable" | "invalid" | "failed";
  retryable: boolean;
};

function classify(
  code: string | null,
): Pick<AssistantRequestFailure, "reason" | "retryable"> {
  switch (code) {
    case "AI_USAGE_LIMIT_REACHED":
      return { reason: "usage", retryable: true };
    case "AI_CONFIGURATION_REQUIRED":
    case "AI_LIMIT_CONFIGURATION_INVALID":
    case "ASSISTANT_CONNECTION_CHANGED":
      return { reason: "unconfigured", retryable: true };
    case "AI_TIMEOUT":
    case "AI_RATE_LIMITED":
    case "AI_PROVIDER_UNAVAILABLE":
      return { reason: "unavailable", retryable: true };
    case "AI_OUTPUT_PARSE_ERROR":
    case "INVALID_RESPONSE_MODE":
    case "INVALID_SOURCE_REFERENCE":
    case "SOURCE_NOT_PROVIDED":
    case "TRIGGER_SOURCE_REQUIRED":
      return { reason: "invalid", retryable: true };
    case "INTERPRETATION_FAILED":
    case "AI_REQUEST_REJECTED":
      return { reason: "failed", retryable: true };
    default:
      return { reason: "failed", retryable: false };
  }
}

export function assistantRequestFailures(
  messages: readonly RequestMessage[],
  readings: Snapshot["interpretations"],
) {
  const failures = new Map<string, AssistantRequestFailure>();
  const byMessage = new Map(messages.map((m) => [m.id, m]));
  const replies = new Set(
    messages
      .filter((m) => m.actor_kind === "miriam")
      .map((m) => m.reply_to_source_id),
  );
  for (const reading of readings) {
    if (
      reading.status !== "failed" ||
      reading.explicitRequest === false ||
      reading.otherMemberTarget ||
      reading.hasPublishedReply ||
      replies.has(reading.source_id)
    )
      continue;
    const message = byMessage.get(
      reading.requestMessageId ?? reading.source_id,
    );
    if (
      !message ||
      message.actor_kind !== "human" ||
      message.purpose !== "conversation"
    )
      continue;
    const displayName = reading.requestDisplayName ?? "Emme";
    // Legacy snapshots without an attributed addressee are safe only when the
    // address cannot name a human in this space.
    const addressed =
      isAssistantAddress(message.content, displayName) &&
      (reading.otherMemberTarget === false ||
        !potentiallyHumanAddress(message.content, displayName));
    if (
      reading.explicitRequest ||
      reading.requestMessageId ||
      message.assistanceContext ||
      addressed
    ) {
      failures.set(message.id, {
        interpretationId: reading.id,
        displayName,
        ...classify(reading.error_code),
      });
    }
  }
  return failures;
}

export function assistantFailureText(
  reason: AssistantRequestFailure["reason"],
  displayName: string,
  t: (source: string, ...values: (string | number)[]) => string,
) {
  switch (reason) {
    case "usage":
      return t(
        "{0} non ha potuto rispondere: limite di utilizzo dell’AI raggiunto. Il messaggio è salvo.",
        displayName,
      );
    case "unconfigured":
      return t(
        "La connessione di {0} richiede una verifica. Il messaggio è salvo.",
        displayName,
      );
    case "unavailable":
      return t(
        "{0} è temporaneamente fuori servizio. Il messaggio è salvo.",
        displayName,
      );
    case "invalid":
      return t(
        "{0} non ha restituito una risposta utilizzabile. Il messaggio è salvo.",
        displayName,
      );
    case "failed":
      return t(
        "{0} non ha potuto completare questa richiesta. Il messaggio è salvo.",
        displayName,
      );
  }
}
