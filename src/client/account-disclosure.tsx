"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function AccountDisclosure({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    function inChildDialog(target: EventTarget | null) {
      const modal = target instanceof Element && target.closest("dialog:modal");
      return !!modal && !modal.contains(details);
    }
    function outside(event: MouseEvent) {
      if (inChildDialog(event.target)) return;
      if (details?.open && !event.composedPath().includes(details))
        details.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !details?.open) return;
      // Let a profile dialog above the menu handle its own Escape.
      if (inChildDialog(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      details.open = false;
      details.querySelector("summary")?.focus({ preventScroll: true });
    }
    const drawer = details.closest("dialog");
    function onDrawerClose() {
      if (details && drawer && !drawer.open) details.open = false;
    }
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", escape, true);
    drawer?.addEventListener("close", onDrawerClose);
    return () => {
      document.removeEventListener("click", outside, true);
      document.removeEventListener("keydown", escape, true);
      drawer?.removeEventListener("close", onDrawerClose);
    };
  }, []);
  return <details ref={ref}>{children}</details>;
}
