import { describe, expect, it } from "vitest";
import {
  verifiedReceipt,
  type PendingCommand,
} from "../src/client/command-journal";

const creation: PendingCommand = {
  commandId: "72fb2883-13ea-4b27-925c-8b44ad88c79c",
  workspace: "72fb2883-13ea-4b27-925c-8b44ad88c79c",
  actor: "member",
  createdAt: "2026-09-14T00:00:00Z",
  command: {
    type: "workspace.create",
    name: "RIMIAM",
    description: "Prepariamo la beta",
  },
};
describe("client receipt boundary", () => {
  it("accepts only the confirmed identity, retaining a false/mismatched outcome as unknown", () => {
    const committed = {
      commandId: creation.commandId,
      status: "committed",
      result: { id: creation.workspace },
    };
    expect(verifiedReceipt(creation, committed)).toEqual({
      id: creation.workspace,
    });
    for (const payload of [
      { ...committed, status: "pending" },
      { ...committed, commandId: "5da0a929-78cb-42d6-996d-a620df149388" },
      { ...committed, result: { id: "5da0a929-78cb-42d6-996d-a620df149388" } },
      { ...committed, result: null },
    ])
      expect(() => verifiedReceipt(creation, payload)).toThrow(
        "INVALID_RECEIPT",
      );
  });
  it("retains ordinary command result semantics without assuming every command creates a Workspace", () => {
    const message = {
      ...creation,
      command: { type: "message.send" as const, content: "Da dove partiamo?" },
    };
    expect(
      verifiedReceipt(message, {
        commandId: message.commandId,
        status: "committed",
        result: { sourceId: "shared-source" },
      }),
    ).toEqual({ sourceId: "shared-source" });
  });
});
