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
  return {
    onScroll: capture,
    followLatest: () => {
      positions.current.set(`${scope}:latest`, { top: 0, follow: true });
      if (!historical && ref.current)
        ref.current.scrollTop = ref.current.scrollHeight;
    },
  };
}
