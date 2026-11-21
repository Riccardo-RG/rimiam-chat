import { newCommand } from "./command-journal";
import type { Command } from "../contracts/commands";

import {
  optionalMediaReading,
  validateAttachment,
} from "../shared/attachment-format";
export {
  acceptedFiles,
  optionalMediaReading,
  validateAttachment,
} from "../shared/attachment-format";

type Upload = Extract<Command, { type: "document.upload" }>;

export async function encodeAttachment(file: File) {
  validateAttachment(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return { filename: file.name, bytesBase64: btoa(chunks.join("")) };
}

export async function createFileUploadCommand(
  actor: string,
  workspace: string,
  file: File,
  options: {
    allowModelProcessing?: boolean;
    previousSourceId?: string;
    conversationShare?: Upload["conversationShare"];
  } = {},
) {
  const command: Upload = {
    type: "document.upload",
    ...(await encodeAttachment(file)),
    ...(options.allowModelProcessing && optionalMediaReading(file.name)
      ? { allowModelProcessing: true }
      : {}),
    ...(options.previousSourceId
      ? { previousSourceId: options.previousSourceId }
      : {}),
    ...(options.conversationShare
      ? { conversationShare: options.conversationShare }
      : {}),
  };
  return { ...newCommand(actor, workspace, command), command };
}

export type FileUploadRequest = Awaited<
  ReturnType<typeof createFileUploadCommand>
>;
