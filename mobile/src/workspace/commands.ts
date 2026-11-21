import * as Crypto from "expo-crypto";
import { releaseUnusedSketches } from "./sketch-files";
import {
  commandJournal,
  hiddenItemPreferences,
  journalIdentity,
  secureJournal,
} from "./journal";
import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";
import type { Command } from "../../../src/contracts/commands";
import type { DirectView } from "../../../src/contracts/direct-chat";
import type { ChatState } from "../../../src/contracts/personal-chats";
import type { WorkspaceInvitations } from "../../../src/contracts/workspace-invitations";
import type { CommandReceipt } from "../../../src/contracts/v1";
import { ApiError, post, type NativeRequest } from "../api";

export type Attachment = {
  uri: string;
  filename: string;
  size: number;
  hash: string;
};
export type Creation = {
  name: string;
  description?: string;
  invitations?: WorkspaceInvitations;
  assistantConnectionId?: string;
  assistantConnectionRevision?: string;
};
export type Operation =
  | {
      kind: "personalAsk";
      target: string;
      selectionVersion: number;
      question: string;
    }
  | { kind: "direct"; text: string; quoteId?: string }
  | { kind: "command"; command: Command }
  | { kind: "create"; creation: Creation }
  | {
      kind: "source";
      file: Attachment;
      allowModelProcessing: boolean;
      shareToConversation?: true;
    }
  | { kind: "voice"; mode: "message" | "miriam"; file: Attachment };
export type Intent = Operation & {
  label: string;
  files?: Attachment[];
  draftToken?: string;
};
export type Pending = { id: string; intent: Intent };
export type Scope = {
  origin: string;
  actorId: string;
  workspaceId?: string;
  directId?: string;
  lane?: "call-exit";
};

export const workspacePath = (id: string) =>
  "/api/v1/workspaces/" + encodeURIComponent(id);
export const sizeLimit = 8 * 1024 * 1024;
const hash = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
const secureOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const storeKey = async (scope: Scope) =>
  "rimiam.pending." + (await hash(journalIdentity(scope)));
const deviceStore = {
  get: (key: string) => SecureStore.getItemAsync(key, secureOptions),
  set: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, secureOptions),
  remove: (key: string) => SecureStore.deleteItemAsync(key, secureOptions),
};
const journal = commandJournal(deviceStore, Crypto.randomUUID);
const hiddenLibrary = hiddenItemPreferences(deviceStore, Crypto.randomUUID);
export const hiddenLibraryKey = async (scope: Scope) =>
  "rimiam.library.hidden." + (await hash(journalIdentity(scope)));
export const readHiddenLibrary = hiddenLibrary.read;
export const setLibraryItemHidden = hiddenLibrary.set;

export type ComposerDraft = {
  token: string;
  text: string;
  mentionIds?: string[];
  quoteId?: string;
  topic?: { id: string; version: number; title: string };
  ask: boolean;
  files: Attachment[];
};
const drafts = secureJournal<ComposerDraft>(deviceStore, Crypto.randomUUID);
export const draftKey = async (scope: Scope) =>
  "rimiam.draft." + (await hash(journalIdentity(scope)));
export async function loadComposerDraft(key: string) {
  return (await drafts.read(key))?.intent ?? null;
}
export const saveComposerDraft = drafts.replace;
export async function clearSubmittedDraft(
  scope: Scope,
  token: string,
  files: readonly Attachment[] = [],
) {
  const key = await draftKey(scope);
  await drafts.clearMatching(key, (draft) => draft.token === token);
  if (files.length)
    releaseUnusedSketches(files, (await loadComposerDraft(key))?.files ?? []);
}
export async function loadPending(scope: Scope) {
  return journal.read(await storeKey(scope));
}
export async function savePending(scope: Scope, intent: Intent) {
  return journal.write(await storeKey(scope), intent);
}
export async function clearPending(scope: Scope, pending: Pending) {
  await journal.clear(await storeKey(scope), pending);
  const { intent } = pending;
  if (intent.kind !== "source" || !intent.shareToConversation) return;
  const name = intent.file.uri.split("/").pop() ?? "";
  if (!/^rimiam-note-[0-9a-f-]{36}\.txt$/i.test(name)) return;
  try {
    const generatedNote = new File(Paths.cache, name);
    if (generatedNote.uri === intent.file.uri && generatedNote.exists)
      generatedNote.delete();
  } catch {
    // Removing a disposable cache copy must not invalidate a settled receipt.
  }
}
export async function captureAttachment(
  uri: string,
  filename: string,
): Promise<Attachment> {
  const file = new File(uri);
  if (!file.exists || file.size <= 0 || file.size > sizeLimit)
    throw new Error("Scegli un file leggibile entro 8 MiB.");
  return {
    uri,
    filename,
    size: file.size,
    hash: await hash(await file.base64()),
  };
}
async function materialize(files: Attachment[]) {
  const attachments = [];
  for (const item of files) {
    const file = new File(item.uri);
    if (!file.exists || file.size !== item.size)
      throw new Error("L’allegato originale non è più disponibile.");
    const bytesBase64 = await file.base64();
    if ((await hash(bytesBase64)) !== item.hash)
      throw new Error("L’allegato originale è cambiato.");
    attachments.push({ filename: item.filename, bytesBase64 });
  }
  return attachments;
}
export async function transmit(
  request: NativeRequest,
  scope: Scope,
  pending: Pending,
) {
  const { id, intent } = pending;
  if (intent.kind === "personalAsk") {
    if (!scope.workspaceId)
      throw new Error("Conversazione personale mancante.");
    await request(
      "/api/v1/personal-chats",
      post({
        action: "ask",
        expectedActorId: scope.actorId,
        thread: scope.workspaceId,
        target: intent.target,
        expectedVersion: intent.selectionVersion,
        question: intent.question,
        id,
      }),
    );
    return;
  }
  const files = intent.files?.length
    ? { attachments: await materialize(intent.files) }
    : {};
  const envelope = { commandId: id, expectedActorId: scope.actorId };
  if (intent.kind === "direct") {
    if (!scope.directId) throw new Error("Conversazione privata mancante.");
    const result = await request<{ messageId: string }>(
      "/api/v1/direct-chats/" + scope.directId,
      post({
        type: "send",
        id,
        expectedActorId: scope.actorId,
        text: intent.text,
        quoteId: intent.quoteId,
        ...files,
      }),
    );
    if (result.messageId !== id)
      throw new Error("Conferma del messaggio non riconosciuta.");
    return;
  }
  if (intent.kind === "create") {
    const result = await request<{ id: string }>(
      "/api/v1/workspaces",
      post({ ...envelope, ...intent.creation, ...files }),
    );
    if (result.id !== id) throw new Error("Identità dello spazio inattesa.");
    return;
  }
  if (!scope.workspaceId) throw new Error("Spazio mancante.");
  let command: Command;
  if (intent.kind === "source") {
    command = {
      type: "document.upload",
      ...(await materialize([intent.file]))[0],
      ...(intent.allowModelProcessing && { allowModelProcessing: true }),
      ...(intent.shareToConversation && { conversationShare: {} }),
    };
  } else
    command =
      intent.kind === "voice"
        ? {
            type: "voice.send",
            mode: intent.mode,
            allowModelProcessing: true,
            ...(await materialize([intent.file]))[0],
          }
        : { ...intent.command, ...files };
  const receipt = await request<CommandReceipt>(
    workspacePath(scope.workspaceId) + "/commands",
    post({ ...envelope, command }),
  );
  if (receipt.status !== "committed" || receipt.commandId !== id)
    throw new Error("Conferma dell’invio non riconosciuta.");
  return receipt.result;
}
export async function checkReceipt(
  request: NativeRequest,
  scope: Scope,
  pending: Pending,
) {
  if (pending.intent.kind === "personalAsk") {
    const state = await request<ChatState>(
      "/api/v1/personal-chats?thread=" +
        encodeURIComponent(scope.workspaceId ?? ""),
    );
    return state.turns.some((t) => t.id === pending.id && t.status === "ready");
  }
  if (pending.intent.kind === "direct") {
    if (!scope.directId) throw new Error("Conversazione privata mancante.");
    const view = await request<DirectView>(
      "/api/v1/direct-chats/" + scope.directId,
    );
    return (
      view.me === scope.actorId &&
      view.messages.some(
        (m) => m.id === pending.id && m.authorId === scope.actorId,
      )
    );
  }
  try {
    const result = await request<CommandReceipt>(
      workspacePath(scope.workspaceId ?? pending.id) +
        "/receipts/" +
        pending.id,
    );
    return result.status === "committed" && result.commandId === pending.id;
  } catch (error) {
    // A newly requested space may not exist yet. A missing receipt never creates a new ID.
    if (
      error instanceof ApiError &&
      (error.code === "RECEIPT_NOT_FOUND" ||
        (!scope.workspaceId && error.status === 403))
    )
      return false;
    throw error;
  }
}
