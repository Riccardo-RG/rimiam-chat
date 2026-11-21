"use client";

import { useEffect, useRef, useState } from "react";

export type WorkspaceConnection =
  "loading" | "live" | "reconnecting" | "offline" | "failed";

/** Read-only synchronization. It never retries commands or interprets worker health. */
export function connectWorkspace(
  workspace: string,
  read: (signal: AbortSignal) => Promise<void>,
  changed: (state: WorkspaceConnection) => void,
) {
  let controller = new AbortController();
  const path = `/api/workspaces/${workspace}/events`;
  let events = new EventSource(path);
  let terminal = false;
  let loaded = false;
  let failed = false;
  let running = false;
  let pending = false;
  let closed = false;
  let outageChecked = false;
  let terminalChecked = false;
  let wasBackgrounded = document.visibilityState === "hidden";
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 2000;
  let previous: WorkspaceConnection | undefined;

  function cancelRecovery() {
    clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
  }

  function scheduleRecovery() {
    if (
      closed ||
      recoveryTimer !== undefined ||
      !navigator.onLine ||
      document.visibilityState !== "visible"
    )
      return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      if (!closed && navigator.onLine && document.visibilityState === "visible")
        void retry();
    }, retryDelay);
    retryDelay = Math.min(30_000, retryDelay * 2);
  }

  function publish() {
    if (closed) return;
    // An offline cycle can leave the stream OPEN without another open event.
    // Use its actual state rather than a separate connectivity-event flag.
    const state: WorkspaceConnection = !navigator.onLine
      ? "offline"
      : failed || terminal
        ? "failed"
        : loaded && events.readyState === EventSource.OPEN
          ? "live"
          : loaded
            ? "reconnecting"
            : "loading";
    if (state !== previous) {
      previous = state;
      changed(state);
    }
  }

  async function refresh() {
    if (closed) return;
    if (!navigator.onLine) {
      publish();
      return;
    }
    if (running) {
      // Many revision hints during one read need only one subsequent read.
      pending = true;
      return;
    }
    running = true;
    const signal = controller.signal;
    try {
      await read(signal);
      if (signal.aborted) return;
      loaded = true;
      failed = false;
      if (terminal) scheduleRecovery();
      else {
        cancelRecovery();
        if (events.readyState === EventSource.OPEN) retryDelay = 2000;
      }
    } catch (error) {
      if (signal.aborted) return;
      failed = true;
      if (
        error instanceof Error &&
        [
          "NETWORK_UNAVAILABLE",
          "SERVICE_UNAVAILABLE",
          "REQUEST_RATE_LIMITED",
        ].includes(error.message)
      )
        scheduleRecovery();
      else cancelRecovery();
    } finally {
      // A read from before suspension can settle after the replacement read.
      if (!signal.aborted) {
        running = false;
        publish();
        if (pending && !closed) {
          pending = false;
          void refresh();
        }
      }
    }
  }

  function detach(source: EventSource) {
    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
  }

  function attach(source: EventSource) {
    const active = () => !closed && events === source;
    source.onopen = () => {
      if (!active()) return;
      terminal = false;
      outageChecked = false;
      terminalChecked = false;
      publish();
      void refresh();
    };
    source.onmessage = () => {
      if (active()) void refresh();
    };
    source.onerror = () => {
      if (!active()) return;
      terminal = source.readyState === EventSource.CLOSED;
      publish();
      // Revalidate access once per outage and once more if reconnection becomes
      // terminal. EventSource owns backoff; repeated errors must not flood reads.
      if (!outageChecked || (terminal && !terminalChecked)) {
        outageChecked = true;
        if (terminal) terminalChecked = true;
        void refresh();
      }
    };
  }

  function retry(resumed = false) {
    if (closed) return Promise.resolve();
    if (resumed) {
      // After mobile suspension even an OPEN stream or a pending fetch can
      // belong to the old network connection. Start a fresh read generation.
      controller.abort();
      controller = new AbortController();
      running = pending = false;
      loaded = false;
      cancelRecovery();
    }
    if (
      navigator.onLine &&
      (resumed || events.readyState === EventSource.CLOSED)
    ) {
      detach(events);
      events.close();
      events = new EventSource(path);
      terminal = false;
      outageChecked = false;
      terminalChecked = false;
      attach(events);
    }
    publish();
    return refresh();
  }

  const online = () => {
    if (wasBackgrounded && document.visibilityState === "visible") foreground();
    else void retry();
  };
  const offline = () => {
    cancelRecovery();
    publish();
  };
  const background = () => {
    wasBackgrounded = true;
    cancelRecovery();
  };
  const foreground = () => {
    if (document.visibilityState !== "visible") return;
    if (wasBackgrounded && navigator.onLine) {
      wasBackgrounded = false;
      void retry(true);
    } else if (events.readyState === EventSource.CLOSED || failed) {
      void retry();
    }
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") background();
    else foreground();
  };
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted) foreground();
  };
  attach(events);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  window.addEventListener("pagehide", background);
  window.addEventListener("pageshow", restore);
  document.addEventListener("visibilitychange", visibility);
  publish();
  void refresh();

  return {
    refresh: retry,
    close() {
      if (closed) return;
      closed = true;
      pending = false;
      cancelRecovery();
      controller.abort();
      detach(events);
      events.close();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", background);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}

export function useWorkspaceSync(
  actor: string | undefined,
  workspace: string,
  read: (workspace: string, signal?: AbortSignal) => Promise<void>,
) {
  const scope = actor && workspace ? `${actor}:${workspace}` : "";
  const [connection, setConnection] = useState<{
    scope: string;
    state: WorkspaceConnection;
  }>({ scope: "", state: "loading" });
  const current = useRef<ReturnType<typeof connectWorkspace> | null>(null);

  useEffect(() => {
    if (!scope) return;
    const sync = connectWorkspace(
      workspace,
      (signal) => read(workspace, signal),
      (state) => setConnection({ scope, state }),
    );
    current.current = sync;
    return () => {
      current.current = null;
      sync.close();
    };
  }, [scope, workspace, read]);

  return {
    connection: connection.scope === scope ? connection.state : "loading",
    refresh: () => current.current?.refresh(),
  };
}
