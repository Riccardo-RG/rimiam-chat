import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { releaseUnusedSketches } from "./sketch-files";
import { randomUUID } from "expo-crypto";
import {
  draftKey,
  loadComposerDraft,
  saveComposerDraft,
  type ComposerDraft,
  type Intent,
  type Scope,
} from "./commands";
const empty: ComposerDraft = { token: "", text: "", ask: false, files: [] };
type Change = Partial<Omit<ComposerDraft, "token">>;
/** Drafts stay on this device and are separate from idempotent in-flight operations. */
export function useComposerDraft(scope: Scope) {
  const [value, setValue] = useState(empty);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false),
    current = useRef(empty);
  const storageKey = useRef(""),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    dirty = useRef(false);
  const preparing = useRef(false);
  const persist = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || !storageKey.current) return;
    const draft = current.current;
    dirty.current = false;
    try {
      await saveComposerDraft(
        storageKey.current,
        draft.text ||
          draft.quoteId ||
          draft.files.length ||
          draft.ask ||
          draft.mentionIds?.length
          ? draft
          : null,
      );
      if (active.current && current.current === draft) setError("");
    } catch (failure) {
      if (current.current === draft) dirty.current = true;
      if (active.current)
        setError("Questa bozza non è stata salvata sul dispositivo.");
      throw failure;
    }
  }, []);
  useEffect(() => {
    let live = true;
    active.current = true;
    setReady(false);
    setValue(empty);
    current.current = empty;
    setError("");
    void (async () => {
      try {
        const key = await draftKey(scope);
        if (!live) return;
        storageKey.current = key;
        const saved = await loadComposerDraft(key);
        if (live && saved) {
          current.current = saved;
          setValue(saved);
        }
      } catch {
        if (live)
          setError(
            "Non è stato possibile recuperare la bozza sul dispositivo.",
          );
      } finally {
        if (live) setReady(true);
      }
    })();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void persist().catch(() => {});
    });
    return () => {
      live = false;
      active.current = false;
      subscription.remove();
      void persist().catch(() => {});
      storageKey.current = "";
    };
  }, [scope, persist]);
  function edit(change: Change) {
    if (!ready || preparing.current) return;
    current.current = { ...current.current, ...change, token: randomUUID() };
    setValue(current.current);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist().catch(() => {});
    }, 220);
  }
  async function editFiles(change: Change) {
    if (!ready || preparing.current) return false;
    const previous = current.current;
    edit(change);
    const updated = current.current;
    try {
      await persist();
      releaseUnusedSketches(previous.files, current.current.files);
      return true;
    } catch {
      if (current.current === updated) {
        current.current = previous;
        dirty.current = true;
        if (active.current) setValue(previous);
      }
      return false;
    }
  }
  function settled(token?: string) {
    if (!token || current.current.token !== token) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
    current.current = empty;
    setValue(empty);
    setError("");
  }
  async function submit(
    send: (intent: Intent) => Promise<boolean>,
    intent: Intent,
  ) {
    if (!ready || preparing.current) return;
    preparing.current = true;
    try {
      await persist();
      if (!active.current) return;
      await send({ ...intent, draftToken: current.current.token });
    } catch {
      if (active.current)
        setError("Salvataggio non riuscito. Riprova per inviare.");
    } finally {
      preparing.current = false;
    }
  }
  return { value, ready, error, edit, editFiles, settled, submit };
}
