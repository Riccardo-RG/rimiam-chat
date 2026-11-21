import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  newWorkspaceCommand,
  pendingCommands,
  recoverCommand,
  sendCommand,
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

describe("command delivery and local reminders", () => {
  const message: PendingCommand = {
    ...creation,
    command: { type: "message.send", content: "Un messaggio di prova" },
  };
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function prepareDevice() {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("window", new EventTarget());
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("recovers only the member's commands for the selected utility space after reopening", async () => {
    const fetch = prepareDevice();
    fetch.mockRejectedValue(new TypeError("Connection interrupted"));
    const personal = { ...message, commandId: crypto.randomUUID() };
    const shared = {
      ...message,
      commandId: crypto.randomUUID(),
      workspace: crypto.randomUUID(),
    };
    const otherMember = {
      ...personal,
      commandId: crypto.randomUUID(),
      actor: "another-member",
    };
    for (const request of [personal, shared, otherMember]) {
      await expect(sendCommand(request)).rejects.toThrow("NETWORK_UNAVAILABLE");
    }
    await expect(
      pendingCommands(personal.actor, personal.workspace),
    ).resolves.toEqual([personal]);
    await expect(
      pendingCommands(personal.actor, shared.workspace),
    ).resolves.toEqual([shared]);
    expect(await pendingCommands(personal.actor)).toHaveLength(2);
  });

  it("retains the exact invitations on response loss and allows correction after a definite refusal", async () => {
    const fetch = prepareDevice();
    const invitations = {
      recipients: [
        { contactId: "previous-colleague" },
        { email: "self@example.test" },
      ],
      fullHistoryDisclosed: true as const,
    };
    const command = newWorkspaceCommand(
      "member",
      "Nuovo spazio",
      undefined,
      invitations,
    );
    fetch.mockRejectedValueOnce(new TypeError("Connection interrupted"));
    await expect(sendCommand(command)).rejects.toThrow("NETWORK_UNAVAILABLE");
    const [pending] = await pendingCommands("member");
    expect(pending).toEqual(command);
    fetch.mockResolvedValueOnce(
      Response.json({ error: { code: "CANNOT_INVITE_SELF" } }, { status: 400 }),
    );
    await expect(sendCommand(pending)).rejects.toThrow("CANNOT_INVITE_SELF");
    const requests = fetch.mock.calls.map(([, options]) =>
      JSON.parse(String(options?.body)),
    );
    expect(requests[0]).toMatchObject({
      invitations,
      commandId: command.commandId,
    });
    expect(requests[1]).toEqual(requests[0]);
    await expect(pendingCommands("member")).resolves.toEqual([]);
  });

  it("does not dispatch if the initial journal transaction fails", async () => {
    const fetch = prepareDevice();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    });
    await expect(sendCommand(message)).rejects.toThrow(
      "COMMAND_STORAGE_UNAVAILABLE",
    );
    expect(fetch).not.toHaveBeenCalled();
    await expect(pendingCommands(message.actor)).resolves.toEqual([]);
  });

  it.each([message, creation])(
    "preserves a verified $command.type result across failed cleanup and reconciles the original reminder by reading",
    async (command) => {
      const fetch = prepareDevice();
      const result =
        command.command.type === "workspace.create"
          ? { id: command.workspace }
          : { messageId: "shared-source" };
      const receipt = {
        commandId: command.commandId,
        status: "committed",
        result,
      };
      fetch.mockResolvedValueOnce(
        Response.json(
          command.command.type === "workspace.create" ? result : receipt,
        ),
      );
      const remove = IDBObjectStore.prototype.delete;
      const deletion = vi
        .spyOn(IDBObjectStore.prototype, "delete")
        .mockImplementation(function (this: IDBObjectStore, id) {
          const request = remove.call(this, id);
          this.transaction.abort();
          return request;
        });
      await expect(sendCommand(command)).resolves.toEqual(result);
      await expect(pendingCommands(command.actor)).resolves.toEqual([command]);

      fetch.mockImplementation(async () => Response.json(receipt));
      await expect(recoverCommand(command)).resolves.toEqual(result);
      await expect(pendingCommands(command.actor)).resolves.toEqual([command]);

      deletion.mockRestore();
      await expect(recoverCommand(command)).resolves.toEqual(result);
      await expect(pendingCommands(command.actor)).resolves.toEqual([]);
      expect(fetch.mock.calls.map(([, options]) => options?.method)).toEqual([
        "POST",
        "GET",
        "GET",
      ]);
    },
  );
});
