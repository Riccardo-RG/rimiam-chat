"use client";

import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

export function useComposerInteraction(ref: RefObject<HTMLElement | null>) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) return;
    const viewport = window.visualViewport;
    let shortest = viewport?.height ?? 0;
    let width = viewport?.width;
    let touchingControl = false;
    let keyboardTap:
      { button: HTMLButtonElement; x: number; y: number } | undefined;
    function pointerStart(event: PointerEvent) {
      const button =
        event.target instanceof Element
          ? event.target.closest("button:enabled")
          : null;
      touchingControl = !!button && !!ref.current?.contains(button);
      keyboardTap =
        touchingControl &&
        button instanceof HTMLButtonElement &&
        event.pointerType === "touch" &&
        event.isPrimary &&
        document.activeElement instanceof HTMLTextAreaElement &&
        ref.current?.contains(document.activeElement)
          ? { button, x: event.clientX, y: event.clientY }
          : undefined;
    }
    function pointerEnd() {
      touchingControl = false;
      keyboardTap = undefined;
    }
    function finishKeyboardTap(event: TouchEvent) {
      const tap = keyboardTap;
      keyboardTap = undefined;
      const touch = event.changedTouches[0];
      if (
        !tap ||
        !touch ||
        event.touches.length ||
        event.changedTouches.length !== 1 ||
        !event.cancelable ||
        document.activeElement !== document.body ||
        Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > 10 ||
        !tap.button.isConnected ||
        tap.button.disabled ||
        !(event.target instanceof Node && tap.button.contains(event.target))
      )
        return;
      // When a software keyboard blurs the field, WebKit can retarget the later
      // synthesized click to <main>. Complete this same tap inside its original
      // user gesture, and suppress only the browser's replacement click.
      event.preventDefault();
      tap.button.click();
      pointerEnd();
    }
    function keyboardResized() {
      if (!viewport || viewport.scale !== 1) return;
      if (width !== viewport.width) {
        shortest = viewport.height;
        width = viewport.width;
      } else {
        // The native keyboard's Done key returns focus to the page without a DOM click.
        const keyboardClosed = viewport.height - shortest > 100;
        if (
          keyboardClosed &&
          !touchingControl &&
          document.activeElement === document.body
        )
          setEditing(false);
        shortest = keyboardClosed
          ? viewport.height
          : Math.min(shortest, viewport.height);
      }
    }
    function leave(event: Event) {
      const target = event.target;
      if (!(target instanceof Node) || ref.current?.contains(target)) return;
      // WebKit can hand focus to the body between touchstart and click on Send.
      // A completed outside tap, or focus moving to a real control, ends editing.
      if (event.type === "focusin" && target === document.body) return;
      setEditing(false);
    }
    viewport?.addEventListener("resize", keyboardResized);
    document.addEventListener("pointerdown", pointerStart, true);
    document.addEventListener("pointercancel", pointerEnd, true);
    document.addEventListener("touchend", finishKeyboardTap, {
      capture: true,
      passive: false,
    });
    document.addEventListener("click", pointerEnd, true);
    document.addEventListener("focusin", leave, true);
    document.addEventListener("click", leave, true);
    return () => {
      viewport?.removeEventListener("resize", keyboardResized);
      document.removeEventListener("pointerdown", pointerStart, true);
      document.removeEventListener("pointercancel", pointerEnd, true);
      document.removeEventListener("touchend", finishKeyboardTap, true);
      document.removeEventListener("click", pointerEnd, true);
      document.removeEventListener("focusin", leave, true);
      document.removeEventListener("click", leave, true);
    };
  }, [editing, ref]);
  return {
    "data-compose-surface": "",
    "data-editing": editing || undefined,
    onFocusCapture: () => setEditing(true),
    onMouseDown(event: ReactMouseEvent<HTMLElement>) {
      if (
        event.button === 0 &&
        document.activeElement instanceof HTMLTextAreaElement &&
        event.currentTarget.contains(document.activeElement) &&
        event.target instanceof Element &&
        !event.target.closest("dialog") &&
        event.target.closest("button:enabled")
      )
        // Only suppress the mouse default that moves focus. Leave the native
        // touch/pointer sequence intact for submit, file pickers and media.
        event.preventDefault();
    },
  };
}
