import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

/** A drawing may outlive a process restart while its encrypted draft or send receipt still references it. */
export function newSketchFile() {
  const dir = new Directory(Paths.document, "rimiam-sketch-drafts");
  dir.create({ idempotent: true });
  const file = new File(dir, randomUUID() + ".png");
  file.create();
  return file;
}

export function releaseUnusedSketches(
  previous: readonly { uri: string }[],
  retained: readonly { uri: string }[],
) {
  const keep = new Set(retained.map((f) => f.uri));
  for (const { uri } of previous) {
    if (keep.has(uri)) continue;
    const name = uri.split("/").pop() ?? "";
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.png$/i.test(name))
      continue;
    try {
      const file = new File(
        new Directory(Paths.document, "rimiam-sketch-drafts"),
        name,
      );
      if (file.uri === uri && file.exists) file.delete();
    } catch {
      /* Removing a local copy must not invalidate a confirmed send. */
    }
  }
}
