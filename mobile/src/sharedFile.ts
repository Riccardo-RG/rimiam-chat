import { privateMediaCache } from "./private-media-cache";
import { Directory, File } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import * as Sharing from "expo-sharing";
import type { NativeRequest } from "./api";

export async function shareFile(
  request: NativeRequest,
  path: string,
  name: string,
  type: string,
) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Il dispositivo non offre la condivisione dei file.");
  const bytes = await request.bytes(path);
  await shareBytes(bytes, name, type);
}
export async function shareBytes(
  bytes: Uint8Array,
  name: string,
  type: string,
) {
  const dir = new Directory(privateMediaCache(), "export-" + randomUUID());
  dir.create();
  try {
    const safe =
      name
        .replace(/[^\p{L}\p{N} ._-]+/gu, "_")
        .replace(/^\.+/, "")
        .slice(0, 150)
        .trim() || "Documento";
    const file = new File(dir, safe);
    file.create();
    file.write(bytes);
    await Sharing.shareAsync(file.uri, { mimeType: type, dialogTitle: safe });
  } finally {
    if (dir.exists) dir.delete();
  }
}
