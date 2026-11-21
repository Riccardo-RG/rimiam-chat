import assert from "node:assert/strict";
import test from "node:test";
import {
  initialConversationTarget,
  settledVisibleIds,
} from "../src/workspace/entry.ts";
const messages = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
test("ordinary entry opens at the bottom including an empty workspace", () => {
  assert.equal(initialConversationTarget(messages, []), null);
  assert.equal(initialConversationTarget([], ["b"]), null);
});
test("the newest unread mention wins regardless of inbox ordering", () => {
  assert.equal(initialConversationTarget(messages, ["d", "b", "absent"]), "d");
  assert.equal(initialConversationTarget(messages, ["e", "a"]), "e");
});
test("explicit original or mention takes precedence; unavailable target falls back", () => {
  assert.equal(initialConversationTarget(messages, ["d"], "b"), "b");
  assert.equal(initialConversationTarget(messages, ["d"], "invisible"), "d");
});
test("intermediate viewports never acknowledge mentions during a programmatic jump", () => {
  assert.deepEqual(settledVisibleIds(["e", "d"], "b"), []);
  assert.deepEqual(settledVisibleIds(["c", "b"], "b"), ["c", "b"]);
  assert.deepEqual(settledVisibleIds(["e"], null), ["e"]);
});
