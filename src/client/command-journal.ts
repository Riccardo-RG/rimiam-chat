import type { Command } from "@/contracts/commands";
import { receiptSchema, type CommandReceipt } from "../contracts/v1";
import { api } from "./api";

export type PendingCommand = {
  commandId: string;
  actor: string;
  workspace: string;
  command:
    Command | { type: "workspace.create"; name: string; description?: string };
  createdAt: string;
};
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("miriam-pending-commands", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("commands", { keyPath: "commandId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("COMMAND_STORAGE_UNAVAILABLE"));
  });
}
async function write(command: PendingCommand | string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("commands", "readwrite");
      const store = tx.objectStore("commands");
      if (typeof command === "string") store.delete(command);
      else store.put(command);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(new Error("COMMAND_STORAGE_UNAVAILABLE"));
    });
    window.dispatchEvent(new Event("miriam-pending-commands"));
  } finally {
    db.close();
  }
}
export async function pendingCommands(actor: string) {
  const db = await database();
  try {
    return await new Promise<PendingCommand[]>((resolve, reject) => {
      const request = db
        .transaction("commands")
        .objectStore("commands")
        .getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as PendingCommand[]).filter((c) => c.actor === actor),
        );
      request.onerror = () => reject(new Error("COMMAND_STORAGE_UNAVAILABLE"));
    });
  } finally {
    db.close();
  }
}
export const forgetCommand = (id: string) => write(id);
export function verifiedReceipt(command: PendingCommand, payload: unknown) {
  const receipt = receiptSchema.safeParse(payload);
  if (
    !receipt.success ||
    receipt.data.commandId !== command.commandId ||
    (command.command.type === "workspace.create" &&
      receipt.data.result.id !== command.workspace)
  )
    throw new Error("INVALID_RECEIPT");
  return receipt.data.result;
}
export async function recoverCommand(command: PendingCommand) {
  const receipt = await api<CommandReceipt>(
    `/api/v1/workspaces/${command.workspace}/receipts/${command.commandId}`,
  );
  const result = verifiedReceipt(command, receipt);
  await write(command.commandId);
  return result;
}
export async function sendCommand(
  command: PendingCommand,
): Promise<Record<string, unknown>> {
  // Do not send if persistence fails: response-loss recovery must survive a reload.
  await write(command);
  if (command.command.type === "workspace.create") {
    const result = await api<{ id: string }>("/api/v1/workspaces", {
      commandId: command.commandId,
      expectedActorId: command.actor,
      name: command.command.name,
      description: command.command.description,
    });
    if (result.id !== command.workspace) throw new Error("INVALID_RECEIPT");
    await write(command.commandId);
    return result;
  }
  const receipt = await api<CommandReceipt>(
    `/api/v1/workspaces/${command.workspace}/commands`,
    {
      commandId: command.commandId,
      expectedActorId: command.actor,
      command: command.command,
    },
  );
  const result = verifiedReceipt(command, receipt);
  await write(command.commandId);
  return result;
}
export function newWorkspaceCommand(
  actor: string,
  name: string,
  description?: string,
): PendingCommand {
  const commandId = crypto.randomUUID();
  return {
    actor,
    workspace: commandId,
    commandId,
    command: {
      type: "workspace.create",
      name,
      ...(description ? { description } : {}),
    },
    createdAt: new Date().toISOString(),
  };
}
export function newCommand(
  actor: string,
  workspace: string,
  command: Command,
): PendingCommand {
  return {
    actor,
    workspace,
    command,
    commandId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
}
