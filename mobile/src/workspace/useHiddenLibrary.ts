import { useEffect, useRef, useState } from "react";
import {
  hiddenLibraryKey,
  readHiddenLibrary,
  setLibraryItemHidden,
} from "./commands";

export function useHiddenLibrary(
  origin: string,
  actorId: string,
  workspaceId: string,
) {
  const identity = JSON.stringify([origin, actorId, workspaceId]);
  const [state, setState] = useState<{
    identity: string;
    key: string;
    ids: Set<string>;
  } | null>(null);
  const active = useRef("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let mounted = true;
    active.current = identity;
    setFailed(false);
    void hiddenLibraryKey({ origin, actorId, workspaceId })
      .then(async (key) => {
        const ids = await readHiddenLibrary(key);
        if (mounted) setState({ identity, key, ids: new Set(ids) });
      })
      .catch(() => {
        if (mounted) setFailed(true);
      });
    return () => {
      mounted = false;
      active.current = "";
    };
  }, [identity, origin, actorId, workspaceId, attempt]);
  const current = state?.identity === identity ? state : null;
  async function change(id: string, hide: boolean) {
    if (!current) return false;
    try {
      const ids = await setLibraryItemHidden(current.key, id, hide);
      if (active.current !== identity) return false;
      setState({ ...current, ids: new Set(ids) });
      setFailed(false);
      return true;
    } catch {
      if (active.current === identity) setFailed(true);
      return false;
    }
  }
  return {
    ids: current?.ids,
    failed,
    change,
    retry: () => setAttempt((n) => n + 1),
  };
}
