import { expect, it } from "vitest";
import {
  assistantFailureText,
  assistantRequestFailures,
} from "../src/shared/assistant-request-failures";
import { translateUi } from "../src/shared/i18n";

const question = {
  id: "question",
  content: "@Emme riesci a leggere il confronto?",
  actor_kind: "human" as const,
  purpose: "conversation" as const,
  reply_to_source_id: null,
};
const failed = {
  id: "reading",
  source_id: question.id,
  status: "failed",
  error_code: "AI_TIMEOUT",
  requestDisplayName: "Iris",
};

it.each([
  ["AI_USAGE_LIMIT_REACHED", "usage", true],
  ["AI_CONFIGURATION_REQUIRED", "unconfigured", true],
  ["ASSISTANT_CONNECTION_CHANGED", "unconfigured", true],
  ["AI_PROVIDER_UNAVAILABLE", "unavailable", true],
  ["AI_RATE_LIMITED", "unavailable", true],
  ["AI_TIMEOUT", "unavailable", true],
  ["AI_OUTPUT_PARSE_ERROR", "invalid", true],
  ["INTERPRETATION_FAILED", "failed", true],
  ["unexpected diagnostic /api/secret", "failed", false],
])(
  "projects %s as a localized, bounded request failure",
  (error_code, reason, retryable) => {
    const failure = assistantRequestFailures(
      [question],
      [{ ...failed, error_code }],
    ).get(question.id)!;
    expect(failure).toEqual({
      interpretationId: failed.id,
      displayName: "Iris",
      reason,
      retryable,
    });
    const text = (locale: "it" | "en") =>
      assistantFailureText(
        failure.reason,
        failure.displayName,
        (source, ...args) => translateUi(locale, source, ...args),
      );
    expect(text("it")).toContain("Il messaggio è salvo.");
    expect(text("en")).toContain("Your message is saved.");
    expect(text("it")).toContain("Iris");
    expect(text("it")).not.toContain(error_code);
  },
);

it("recognizes a directly addressed voice note by its linked transcript, even with no textual address", () => {
  const voice = { ...question, content: "Messaggio vocale a Emme" };
  const transcript = {
    ...failed,
    source_id: "transcript",
    requestMessageId: voice.id,
  };
  expect(
    assistantRequestFailures([voice], [transcript]).get(voice.id)
      ?.interpretationId,
  ).toBe(failed.id);
  expect(
    assistantRequestFailures(
      [voice],
      [{ ...transcript, requestMessageId: null }],
    ).size,
  ).toBe(0);
});

it("suppresses notices for earlier published replies outside the current page, silent background processing, other people and system messages", () => {
  expect(
    assistantRequestFailures(
      [question],
      [{ ...failed, hasPublishedReply: true }],
    ).size,
  ).toBe(0);
  expect(
    assistantRequestFailures(
      [question],
      [{ ...failed, otherMemberTarget: true }],
    ).size,
  ).toBe(0);
  expect(
    assistantRequestFailures([{ ...question, content: "Come stai?" }], [failed])
      .size,
  ).toBe(0);
  expect(
    assistantRequestFailures([{ ...question, purpose: "goal_event" }], [failed])
      .size,
  ).toBe(0);
  expect(
    assistantRequestFailures([{ ...question, actor_kind: "miriam" }], [failed])
      .size,
  ).toBe(0);
});
