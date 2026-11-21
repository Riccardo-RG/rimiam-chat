import { useMemo, useSyncExternalStore } from "react";

const changedEvent = "rimiam-library-hidden-changed";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changedEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changedEvent, listener);
  };
}

function read(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function decode(raw: string): Set<string> {
  try {
    const values: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(values)
        ? values.filter((id) => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

// This is a browser display preference. Store identifiers only, separately for
// each signed-in member and workspace. Never change the underlying source.
export function useHiddenLibraryItems(actor: string, workspace: string) {
  const key = "rimiam-library-hidden:" + actor + ":" + workspace;
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => "",
  );
  const hidden = useMemo(() => decode(raw), [raw]);

  function setHidden(id: string, hide: boolean) {
    const next = decode(read(key));
    if (hide) next.add(id);
    else next.delete(id);
    try {
      if (next.size) localStorage.setItem(key, JSON.stringify([...next]));
      else localStorage.removeItem(key);
      window.dispatchEvent(new Event(changedEvent));
      return true;
    } catch {
      return false;
    }
  }
  return { hidden, setHidden };
}
