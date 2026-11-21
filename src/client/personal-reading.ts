"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  PersonalReading,
  ReadingInput,
} from "../contracts/conversation-reading";

export function usePersonalReading(
  ref: RefObject<HTMLDivElement | null>,
  workspace: string,
  actor: string | undefined,
  state: PersonalReading | undefined,
  visible: boolean,
  messagesKey: string,
  onRestored: () => void,
  direct = false,
  requestedMessage?: string,
) {
  const [away, setAway] = useState(false);
  const [seenView, setSeenView] = useState<{ scope: string; ids: Set<string> }>(
    { scope: "", ids: new Set() },
  );
  const scope = workspace + ":" + actor + ":" + state?.admission;
  const [entryReading, setEntryReading] = useState<{
    scope: string;
    id: string | null;
  }>({ scope: "", id: null });
  if (entryReading.scope !== scope)
    setEntryReading({ scope, id: state?.unreadIds[0] ?? null });
  const [remote, setRemote] = useState<{
    scope: string;
    source: PersonalReading;
    reading: PersonalReading;
  } | null>(null);
  const effective =
    remote?.scope === scope && remote.source === state ? remote.reading : state;
  useEffect(() => {
    if (direct || !state || !visible || !workspace || !actor) return;
    const source = state,
      controller = new AbortController();
    async function refresh() {
      if (document.hidden) return;
      try {
        const response = await fetch(
          "/api/v1/workspaces/" + workspace + "/reading",
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) return;
        const reading: PersonalReading = await response.json();
        if (
          !controller.signal.aborted &&
          reading.admission === source.admission
        )
          setRemote({ scope, source, reading });
      } catch {
        /* A later focus or reconnect will revalidate the private projection. */
      }
    }
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [direct, state, visible, workspace, actor, scope]);
  const latest = useRef({
    state: effective,
    visible,
    messagesKey,
    onRestored,
    requestedMessage,
  });
  useLayoutEffect(() => {
    latest.current = {
      state: effective,
      visible,
      messagesKey,
      onRestored,
      requestedMessage,
    };
  }, [effective, visible, messagesKey, onRestored, requestedMessage]);
  const evaluate = useRef<(() => void) | null>(null);
  const hydrated = !!state && !!messagesKey;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !hydrated || !latest.current.state || !workspace || !actor)
      return;
    const initial = latest.current.state;
    // A deliberate jump from Home or a source link takes precedence over ordinary entry.
    const entryId = direct
      ? initial.anchorId
      : (latest.current.requestedMessage ?? initial.mentionIds.at(-1));
    const anchor = entryId
      ? document.getElementById("source-" + entryId)
      : null;
    const entryMessages = latest.current.messagesKey;
    let holdingBookmark = !direct || (!!anchor && root.contains(anchor));
    function restoreBookmark() {
      if (
        !holdingBookmark ||
        !root ||
        latest.current.messagesKey !== entryMessages
      )
        return;
      if (!direct) {
        if (anchor && root.contains(anchor)) {
          // Start a long mention at its first line and leave earlier unread messages unseen.
          root.scrollTop +=
            anchor.getBoundingClientRect().top -
            root.getBoundingClientRect().top;
        } else root.scrollTop = root.scrollHeight;
        latest.current.onRestored();
        return;
      }
      if (!anchor || !root.contains(anchor)) return;
      const messages = root.querySelectorAll("[data-chat-message]");
      const box = anchor.getBoundingClientRect();
      const view = root.getBoundingClientRect();
      if (!initial.anchorAtBottom)
        root.scrollTop += box.top - view.top - initial.anchorOffset;
      else if (messages[messages.length - 1] === anchor)
        root.scrollTop = root.scrollHeight;
      else
        // A later message arrived while away. Reopen at the end of the last
        // exchange this person saw, not at the new end of the conversation.
        root.scrollTop += box.bottom - view.bottom;
      latest.current.onRestored();
    }
    function releaseBookmark() {
      holdingBookmark = false;
    }
    restoreBookmark();
    let cursorVersion = initial.cursorVersion,
      lastAnchor = initial.anchorId
        ? initial.anchorId +
          ":" +
          (initial.anchorAtBottom ? "bottom" : initial.anchorOffset)
        : "",
      busy = false,
      ended = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const admission = initial.admission,
      expectedActorId = actor;
    function collect() {
      if (
        !root ||
        document.visibilityState !== "visible" ||
        !latest.current.visible ||
        !root.clientHeight
      )
        return;
      const view = root.getBoundingClientRect(),
        top = Math.max(0, view.top),
        bottom = Math.min(window.innerHeight, view.bottom),
        unread = new Set(latest.current.state?.unreadIds);
      let first: { id: string; offset: number } | undefined;
      let lastVisible: string | undefined;
      const ids: string[] = [];
      const messages = root.querySelectorAll<HTMLElement>(
        "[data-chat-message]",
      );
      for (const node of messages) {
        const rect = node.getBoundingClientRect();
        if (rect.bottom <= top) continue;
        if (rect.top >= bottom) break;
        const id = node.dataset.chatMessage;
        if (
          !id ||
          Math.min(rect.bottom, bottom) - Math.max(rect.top, top) <
            Math.min(24, rect.height)
        )
          continue;
        first ??= { id, offset: Math.round(rect.top - view.top) };
        lastVisible = id;
        if (!seen.has(id) && unread.has(id) && ids.length < 100) ids.push(id);
      }
      if (!first) return;
      const atBottom =
        root.scrollHeight - root.clientHeight - root.scrollTop <= 2 &&
        lastVisible === messages[messages.length - 1]?.dataset.chatMessage;
      const preservedBottom =
        direct &&
        holdingBookmark &&
        initial.anchorAtBottom &&
        anchor &&
        Math.abs(anchor.getBoundingClientRect().bottom - view.bottom) <= 2;
      const bottomId = atBottom
        ? lastVisible
        : preservedBottom
          ? initial.anchorId
          : null;
      const bookmark = bottomId
        ? { id: bottomId, offset: 0, atBottom: true }
        : first;
      const key = bookmark.id + ":" + (bottomId ? "bottom" : bookmark.offset);
      if (!ids.length && lastAnchor === key) return;
      const body: ReadingInput = {
        expectedActorId,
        admission,
        seen: ids,
        ...(key !== lastAnchor
          ? { anchor: { ...bookmark, expectedVersion: cursorVersion } }
          : {}),
      };
      return { body, key };
    }
    async function write(keepalive = false) {
      if (busy || (ended && !keepalive)) return;
      const item = collect();
      if (!item) return;
      busy = true;
      let delivered = false;
      try {
        const res = await fetch(
          direct
            ? "/api/v1/direct-chats/" + workspace
            : "/api/v1/workspaces/" + workspace + "/reading",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              direct
                ? {
                    type: "read",
                    expectedActorId: item.body.expectedActorId,
                    seen: item.body.seen,
                    anchor: item.body.anchor,
                  }
                : item.body,
            ),
            keepalive,
          },
        );
        if (!res.ok) return;
        const { cursorVersion: version } = (await res.json()) as {
          cursorVersion: number;
        };
        // A different open device can move its own view. Do not resend the
        // rejected anchor until this reader makes another real navigation.
        lastAnchor = item.key;
        cursorVersion = version;
        item.body.seen.forEach((id) => seen.add(id));
        if (!ended && item.body.seen.length)
          setSeenView({ scope, ids: new Set(seen) });
        delivered = true;
      } catch {
        /* Offline: repeat on connectivity, visibility, or the next genuine view. */
      } finally {
        busy = false;
        if (delivered && !ended && collect()) schedule();
      }
    }
    function schedule() {
      if (ended || !root) return;
      setAway(root.scrollHeight - root.scrollTop - root.clientHeight > 64);
      clearTimeout(timer);
      timer = setTimeout(() => void write(), 320);
    }
    evaluate.current = schedule;
    root.addEventListener("scroll", schedule, { passive: true });
    // A delayed preview may change the bookmarked article's height after
    // admission. Never re-anchor once the reader navigates or uses a control.
    root.addEventListener("load", restoreBookmark, true);
    root.addEventListener("focusin", releaseBookmark);
    document.addEventListener("pointerdown", releaseBookmark, true);
    document.addEventListener("keydown", releaseBookmark, true);
    root.addEventListener("wheel", releaseBookmark, { passive: true });
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("online", schedule);
    window.addEventListener("focus", schedule);
    const observer = new ResizeObserver(() => {
      restoreBookmark();
      schedule();
    });
    observer.observe(root);
    schedule();
    return () => {
      void write(true);
      ended = true;
      clearTimeout(timer);
      evaluate.current = null;
      root.removeEventListener("scroll", schedule);
      root.removeEventListener("load", restoreBookmark, true);
      root.removeEventListener("focusin", releaseBookmark);
      document.removeEventListener("pointerdown", releaseBookmark, true);
      document.removeEventListener("keydown", releaseBookmark, true);
      root.removeEventListener("wheel", releaseBookmark);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("online", schedule);
      window.removeEventListener("focus", schedule);
      observer.disconnect();
    };
  }, [actor, workspace, scope, hydrated, ref, direct]);
  useEffect(() => {
    evaluate.current?.();
  }, [messagesKey, state, visible]);
  const actualSeen = seenView.scope === scope ? seenView.ids : null;
  return {
    away,
    firstUnreadAtEntry: entryReading.scope === scope ? entryReading.id : null,
    unread: (effective?.unreadIds ?? []).filter((id) => !actualSeen?.has(id)),
    mentions: (effective?.mentionIds ?? []).filter(
      (id) => !actualSeen?.has(id),
    ),
  };
}
