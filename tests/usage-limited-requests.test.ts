import { expect, it } from "vitest";
import { usageLimitedRequests } from "../src/client/usage-limited-requests";
import { askAboutMessage } from "../src/shared/miriam-address";

const makeMessage = (id: string, content: string) => ({
  id,
  content,
  actor_kind: "human" as const,
  purpose: "conversation" as const,
  reply_to_source_id: null,
});
const failure = (source: string) => ({
  id: "reading-" + source,
  source_id: source,
  status: "failed",
  error_code: "AI_USAGE_LIMIT_REACHED",
});

it("associates a quota failure and manual retry with the exact explicit request rather than the original subject or latest message", () => {
  const messages = [
    makeMessage("original", "Come ci organizziamo?"),
    makeMessage("request", askAboutMessage),
    makeMessage("human", "@Miriam ci sei?"),
    makeMessage("latest", "Io dopo pranzo"),
    makeMessage("composer", "@Emme ci aiuti?"),
  ];
  expect([
    ...usageLimitedRequests(
      messages,
      messages.map((m) => failure(m.id)),
    ),
  ]).toEqual([
    ["request", "reading-request"],
    ["composer", "reading-composer"],
  ]);
});

it("clears the notice on server recovery, preserves other error categories and hides it for already answered requests", () => {
  const source = makeMessage("request", askAboutMessage);
  const reading = failure(source.id);
  for (const status of ["queued", "running", "completed", "stale"]) {
    expect(usageLimitedRequests([source], [{ ...reading, status }]).size).toBe(
      0,
    );
  }
  expect(
    usageLimitedRequests(
      [source],
      [{ ...reading, error_code: "AI_RATE_LIMITED" }],
    ).size,
  ).toBe(0);
  expect(
    usageLimitedRequests(
      [
        source,
        {
          ...makeMessage("answer", "Ecco come possiamo organizzarci."),
          actor_kind: "miriam",
          reply_to_source_id: source.id,
        },
      ],
      [reading],
    ).size,
  ).toBe(0);
});

it("keeps the retry on an explicitly addressed renamed agent and suppresses an identical human address", () => {
  const messages = [
    makeMessage("agent", "@Ada cosa pensi?"),
    makeMessage("person", "@Ada come stai?"),
    makeMessage("ordinary", "cosa pensi?"),
  ];
  const readings = messages.map((m) => ({
    ...failure(m.id),
    requestDisplayName: "Ada",
    otherMemberTarget: m.id === "person",
  }));
  expect([...usageLimitedRequests(messages, readings)]).toEqual([
    ["agent", "reading-agent"],
  ]);
});
