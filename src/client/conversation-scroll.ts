"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/** Local reading position only; it never changes the selected sources or Context. */
export function useConversationScroll(
  ref: RefObject<HTMLDivElement | null>,
  scope: string,
  messageIds: string,
  historical: boolean,
  firstId: string | undefined,
) {
  const positions = useRef(new Map<string, { top: number; follow: boolean }>());
  const current = useRef("");
  const key = `${scope}:${historical ? `before:${firstId ?? "loading"}` : "latest"}`;
  const capture = () => {
    const element = ref.current;
    if (element && messageIds && current.current === key)
      positions.current.set(key, {
        top: element.scrollTop,
        follow:
          element.scrollHeight - element.clientHeight - element.scrollTop < 64,
      });
  };
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !messageIds) return;
    const saved = positions.current.get(key);
    if (current.current !== key) {
      element.scrollTop = saved
        ? saved.follow
          ? element.scrollHeight
          : saved.top
        : historical
          ? 0
          : element.scrollHeight;
    } else if (saved?.follow) {
      element.scrollTop = element.scrollHeight;
    }
    current.current = key;
    positions.current.set(key, {
      top: element.scrollTop,
      follow:
        element.scrollHeight - element.clientHeight - element.scrollTop < 64,
    });
  }, [key, messageIds, historical, ref]);
  const hasMessages = Boolean(messageIds);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !hasMessages) return;
    const keepFollowing = () => {
      if (current.current === key && positions.current.get(key)?.follow)
        element.scrollTop = element.scrollHeight;
    };
    // The editor resizes the viewport. An image can settle later without
    // changing either the viewport or the list of message IDs.
    const observer = new ResizeObserver(keepFollowing);
    observer.observe(element);
    element.addEventListener("load", keepFollowing, true);
    return () => {
      observer.disconnect();
      element.removeEventListener("load", keepFollowing, true);
    };
  }, [key, hasMessages, ref]);
  return {
    onScroll: capture,
    followLatest: () => {
      positions.current.set(`${scope}:latest`, { top: 0, follow: true });
      if (!historical && ref.current)
        ref.current.scrollTop = ref.current.scrollHeight;
    },
  };
}
