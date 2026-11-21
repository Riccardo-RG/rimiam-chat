import type { Intent, Scope } from "./commands";
export function journalIdentity({
  origin,
  actorId,
  directId,
  workspaceId,
  lane,
}: Scope) {
  return JSON.stringify([
    origin,
    actorId,
    directId ? "direct:" + directId : (workspaceId ?? "create"),
    ...(lane ? [lane] : []),
  ]);
}
type Store = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};
type Index = { id: string; count: number };
function validIndex({ id, count }: Index) {
  return (
    /^[a-f0-9-]{36}$/i.test(id) &&
    Number.isSafeInteger(count) &&
    count > 0 &&
    count <= 220
  );
}
/** The index is published last. Every payload chunk stays inside secure storage. */
export function secureJournal<T>(store: Store, newId: () => string) {
  type Entry = { id: string; intent: T };
  const mutations = new Map<string, Promise<unknown>>();
  async function serial<R>(key: string, run: () => Promise<R>) {
    const previous = mutations.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    mutations.set(key, next);
    try {
      return await next;
    } finally {
      if (mutations.get(key) === next) mutations.delete(key);
    }
  }
  async function indexOf(key: string): Promise<Index | null> {
    const text = await store.get(key);
    if (!text) return null;
    const index = JSON.parse(text) as Index;
    if (!validIndex(index))
      throw new Error("Registro sul dispositivo illeggibile.");
    return index;
  }
  async function readEntry(key: string, index: Index): Promise<Entry> {
    const parts = await Promise.all(
      Array.from({ length: index.count }, (_, i) =>
        store.get(key + "." + index.id + "." + i),
      ),
    );
    if (parts.some((part) => part === null))
      throw new Error("Salvataggio incompleto. Conserva la bozza.");
    return { id: index.id, intent: JSON.parse(parts.join("")) as T };
  }
  async function removeParts(key: string, { id, count }: Index) {
    await Promise.allSettled(
      Array.from({ length: count }, (_, i) =>
        store.remove(key + "." + id + "." + i),
      ),
    );
  }
  async function publish(key: string, intent: T): Promise<Entry> {
    const id = newId(),
      characters = Array.from(JSON.stringify(intent)),
      count = Math.ceil(characters.length / 350);
    if (!validIndex({ id, count }))
      throw new Error("La bozza supera lo spazio disponibile per il recupero.");
    let saved = 0;
    try {
      for (let i = 0; i < count; i++) {
        const part = characters.slice(i * 350, (i + 1) * 350).join("");
        await store.set(key + "." + id + "." + i, part);
        saved++;
      }
      await store.set(key, JSON.stringify({ id, count }));
    } catch {
      await removeParts(key, { id, count: saved });
      throw new Error(
        "Non è stato possibile proteggere la bozza sul dispositivo.",
      );
    }
    return { id, intent };
  }
  const read = (key: string) =>
    serial(key, async () => {
      const index = await indexOf(key);
      return index ? readEntry(key, index) : null;
    });
  const write = (key: string, value: T) =>
    serial(key, async () => {
      if (await indexOf(key))
        throw new Error("Verifica prima l’invio precedente.");
      return publish(key, value);
    });
  const clear = (key: string, expected: Entry) =>
    serial(key, async () => {
      const index = await indexOf(key);
      if (!index) return;
      if (index.id !== expected.id)
        throw new Error("L’invio registrato è cambiato.");
      await store.remove(key);
      await removeParts(key, index);
    });
  const replace = (key: string, value: T | null) =>
    serial(key, async () => {
      const previous = await indexOf(key);
      if (value !== null) await publish(key, value);
      else if (previous) await store.remove(key);
      if (previous) await removeParts(key, previous);
    });
  const clearMatching = (key: string, matches: (value: T) => boolean) =>
    serial(key, async () => {
      const previous = await indexOf(key);
      if (!previous || !matches((await readEntry(key, previous)).intent))
        return;
      await store.remove(key);
      await removeParts(key, previous);
    });
  const update = (key: string, change: (current: T | null) => T | null) =>
    serial(key, async () => {
      const previous = await indexOf(key);
      const current = previous ? (await readEntry(key, previous)).intent : null;
      const next = change(current);
      if (next !== null) await publish(key, next);
      else if (previous) await store.remove(key);
      if (previous) await removeParts(key, previous);
      return next;
    });
  return { read, write, clear, replace, update, clearMatching };
}
export function commandJournal(store: Store, newId: () => string) {
  const { read, write, clear } = secureJournal<Intent>(store, newId);
  return { read, write, clear };
}

/** Device-local visibility only. Only stable item identifiers belong in this store. */
export function hiddenItemPreferences(store: Store, newId: () => string) {
  const entries = secureJournal<string[]>(store, newId);
  return {
    read: async (key: string) => (await entries.read(key))?.intent ?? [],
    set: async (key: string, id: string, hide: boolean) =>
      (await entries.update(key, (previous) => {
        const next = new Set(previous);
        if (hide) next.add(id);
        else next.delete(id);
        return next.size ? [...next] : null;
      })) ?? [],
  };
}
