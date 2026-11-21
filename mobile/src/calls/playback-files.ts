import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import type { AttachmentPreview } from "../../../src/contracts/attachment-preview";

export type AudioExtension = Extract<
  AttachmentPreview["preview"],
  { kind: "audio" }
>["extension"];

const directory = () => new Directory(Paths.cache, "rimiam-call-playback");
let prepared = false;

// This private folder is for authenticated audio playback. A terminated app may
// have left an incomplete download or an audio file its player had not released.
export function prepareCallPlayback() {
  if (prepared) return;
  const files = directory();
  if (files.exists) files.delete();
  prepared = true;
}

export function createPlaybackFile(extension: AudioExtension) {
  prepareCallPlayback();
  const files = directory();
  files.create({ idempotent: true });
  const file = new File(files, randomUUID() + "." + extension);
  file.create();
  return file;
}
