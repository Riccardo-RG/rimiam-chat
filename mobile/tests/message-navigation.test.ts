import assert from "node:assert/strict";
import test from "node:test";
import {
  insertMention,
  mentionAtCaret,
  resolveMentionIds,
} from "../../src/shared/conversation-mentions.ts";
import { joinsByFollowingMessage } from "../src/workspace/entry.ts";

test("an explicitly selected namesake stays bound to that person across inline mention editing", () => {
  const text = "Ciao @Gi, controlli la bozza?",
    caret = text.indexOf(",");
  assert.deepEqual(mentionAtCaret(text, caret), {
    query: "Gi",
    start: 5,
    end: 8,
  });
  const inserted = insertMention(text, caret, "Giulia Rossi")!;
  assert.equal(inserted.text, "Ciao @Giulia Rossi , controlli la bozza?");
  const people = [
    { id: "uno", name: "Giulia Rossi" },
    { id: "due", name: "Giulia Rossi" },
  ];
  assert.deepEqual(resolveMentionIds(inserted.text, people), []);
  assert.deepEqual(resolveMentionIds(inserted.text, people, ["due"]), ["due"]);
  assert.deepEqual(
    resolveMentionIds("Ciao, controlli la bozza?", people, ["due"]),
    [],
  );
  assert.equal(mentionAtCaret("assistenza@example", 18), null);
});
test("workspace admissions are chronological with a distinct trailing row and no artificial message IDs", () => {
  const at = (i: number) => new Date(i * 1000).toISOString();
  const messages = [
    { id: "a", created_at: at(2) },
    { id: "b", created_at: at(4) },
  ];
  const map = joinsByFollowingMessage(
    messages,
    [5, 1, 2, 3, 4].map((i) => ({ created_at: at(i), id: i })),
  );
  assert.deepEqual(
    [...map].map(([k, rows]) => [k, rows.map((r) => r.id)]),
    [
      ["a", [1, 2]],
      ["b", [3, 4]],
      ["", [5]],
    ],
  );
  assert.deepEqual(joinsByFollowingMessage([], []), new Map());
});
