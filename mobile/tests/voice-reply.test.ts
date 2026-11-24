import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceReply } from "../src/workspace/voice-reply.ts";
test("the voice panel displays only the written reply to this device’s confirmed voice turn", () => {
  const messages = [
    {
      id: "peer",
      actor_kind: "human",
      reply_to_source_id: "mine",
      content: "human",
    },
    {
      id: "unrelated",
      actor_kind: "miriam",
      reply_to_source_id: "other",
      content: "other member’s answer",
    },
  ];
  assert.equal(
    voiceReply("mine", messages, [
      {
        sourceId: "other",
        errorCode: "failure",
        interpretationStatus: "failed",
      },
    ]).kind,
    "waiting",
  );
  assert.equal(
    voiceReply("mine", messages, [
      { sourceId: "mine", errorCode: "failed", interpretationStatus: null },
    ]).kind,
    "failed",
  );
  assert.deepEqual(
    voiceReply(
      "mine",
      [
        ...messages,
        {
          id: "reply",
          actor_kind: "miriam",
          reply_to_source_id: "mine",
          content: "my answer",
        },
      ],
      [],
    ),
    { kind: "ready", id: "reply", text: "my answer" },
  );
});
