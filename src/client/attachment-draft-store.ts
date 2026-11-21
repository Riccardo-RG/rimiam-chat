export type Item = { id: string; file: File; allowReading: boolean };
type StoredItem = Omit<Item, "file"> & {
  file:
    | File
    | {
        name: string;
        type: string;
        lastModified: number;
        contentBytes: ArrayBuffer;
      };
};
export type Collection = { scope: string; items: Item[] };
type DraftOrder = Pick<Item, "id" | "allowReading">[];
let dbPromise: Promise<IDBDatabase> | undefined;
function openDrafts() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("rimiam-file-drafts", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("drafts");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((error) => {
    dbPromise = undefined;
    throw error;
  });
  return dbPromise;
}
export async function readFiles(scope: string): Promise<Item[]> {
  const db = await openDrafts();
  const stored = await new Promise<StoredItem[]>((resolve, reject) => {
    const req = db.transaction("drafts").objectStore("drafts").get(scope);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
  const saved = stored.map(({ file, ...item }): Item => ({
    ...item,
    file:
      "contentBytes" in file
        ? new File([file.contentBytes], file.name, {
            type: file.type,
            lastModified: file.lastModified,
          })
        : file,
  }));
  // A navigation can interrupt an IndexedDB transaction after the user moved
  // or removed a file. Only its metadata is small enough to save synchronously.
  try {
    const raw = sessionStorage.getItem("rimiam:file-order:" + scope);
    if (raw !== null) {
      const order: DraftOrder = JSON.parse(raw);
      const byId = new Map(saved.map((item) => [item.id, item]));
      return order.flatMap(({ id, allowReading }) => {
        const item = byId.get(id);
        return item ? [{ ...item, allowReading }] : [];
      });
    }
  } catch {
    /* IndexedDB is still authoritative for file content. */
  }
  return saved;
}
const saves = new Map<string, Promise<void>>();
const draftBytes = new WeakMap<File, Promise<ArrayBuffer>>();
export function finishAttachmentSaves() {
  return Promise.allSettled([...saves.values()]);
}
export function storeFiles(draft: Collection) {
  const prior = saves.get(draft.scope);
  const write = (prior ? prior.catch(() => {}) : Promise.resolve()).then(() =>
    persistFiles(draft),
  );
  saves.set(draft.scope, write);
  const finish = () => {
    if (saves.get(draft.scope) === write) saves.delete(draft.scope);
  };
  void write.then(finish, finish);
  return write;
}
async function persistFiles({ scope, items }: Collection) {
  // Safari file-picker handles can expire on navigation. Store portable bytes.
  const records: StoredItem[] = await Promise.all(
    items.map(async ({ file, ...item }) => {
      let bytes = draftBytes.get(file);
      if (!bytes) {
        bytes = file.arrayBuffer();
        draftBytes.set(file, bytes);
      }
      return {
        ...item,
        file: {
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
          contentBytes: await bytes,
        },
      };
    }),
  );
  const db = await openDrafts();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");
    if (records.length) store.put(records, scope);
    else store.delete(scope);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
