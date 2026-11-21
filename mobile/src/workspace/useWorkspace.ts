import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import { ApiError, type NativeRequest, problem } from "../api";
import { workspacePath } from "./commands";

export function useWorkspace(request: NativeRequest, id: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [signal, refresh] = useState(0);
  const revision = useRef<number | null>(null);
  const path = workspacePath(id);
  useEffect(() => {
    let alive = true;
    let busy = false;
    const stop = new AbortController();
    async function fetchState(force = false) {
      if (busy || !alive || AppState.currentState === "background") return;
      busy = true;
      try {
        if (!force && revision.current !== null) {
          const changes = await request<{ headRevision: number }>(
            path + "/changes?after=" + revision.current + "&limit=1",
            { signal: stop.signal },
          );
          if (changes.headRevision === revision.current) {
            if (alive) setError("");
            return;
          }
        }
        const data = await request<Snapshot>(path + "/workspace", {
          signal: stop.signal,
        });
        if (!alive) return;
        revision.current = data.workspace.revision;
        setSnapshot(data);
        setError("");
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          revision.current = null;
          setSnapshot(null);
        }
        setError(problem(e));
      } finally {
        busy = false;
        if (alive) setBusy(false);
      }
    }
    void fetchState(true);
    const timer = setInterval(() => void fetchState(), 4200);
    const listener = AppState.addEventListener("change", (s) => {
      if (s === "active") void fetchState();
    });
    return () => {
      alive = false;
      stop.abort();
      clearInterval(timer);
      listener.remove();
    };
  }, [path, request, signal]);
  return {
    snapshot,
    error,
    busy,
    refresh: useCallback(() => refresh((n) => n + 1), []),
  };
}
