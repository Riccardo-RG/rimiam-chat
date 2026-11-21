import { Directory, Paths } from "expo-file-system";

let prepared = false;

/** Previews and share-sheet copies have no identity or authority after app restart. */
export function privateMediaCache() {
  const dir = new Directory(Paths.cache, "rimiam-private-media");
  if (!prepared && dir.exists) dir.delete();
  dir.create({ idempotent: true });
  prepared = true;
  return dir;
}
