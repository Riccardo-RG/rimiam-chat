"use client";
import { useUiLanguage } from "./ui-language";
import styles from "./navigation-rail.module.css";
import { WorkspaceIcon } from "./workspace-icon";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const compactQuery = "(max-width: 760px)";

export function useWorkspaceRail() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(compactQuery);
    function resized() {
      setDrawerOpen(false);
      notify();
    }
    media.addEventListener("change", resized);
    return () => media.removeEventListener("change", resized);
  }, []);
  const compact = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  function show() {
    if (compact) {
      document
        .getElementById("navigation-toggle")
        ?.focus({ preventScroll: true });
      setDrawerOpen(true);
    } else {
      setCollapsed(false);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>("#workspace-navigation button")
          ?.focus(),
      );
    }
  }
  function hide() {
    if (compact) setDrawerOpen(false);
    else {
      setCollapsed(true);
      requestAnimationFrame(() =>
        document.getElementById("navigation-toggle")?.focus(),
      );
    }
  }
  return { compact, collapsed, drawerOpen: compact && drawerOpen, show, hide };
}

export function RailToggleIcon() {
  return <WorkspaceIcon name="menu" size={24} className={styles.toggleGlyph} />;
}

export function WorkspaceRail({
  layout,
  children,
}: {
  layout: ReturnType<typeof useWorkspaceRail>;
  children: ReactNode;
}) {
  const { t: uiText } = useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const drawer = dialog.current;
    if (!drawer) return;
    // Keep the same rail and its open disclosures when crossing the breakpoint.
    if (!layout.compact) {
      if (drawer.matches(":modal")) drawer.close();
      drawer.open = !layout.collapsed;
    } else if (layout.drawerOpen) {
      if (!drawer.matches(":modal")) {
        if (drawer.open) drawer.close();
        drawer.showModal();
      }
    } else if (drawer.open) drawer.close();
  }, [layout.drawerOpen, layout.compact, layout.collapsed]);
  return (
    <dialog
      ref={dialog}
      className={layout.compact ? "rail-frame rail-drawer" : "rail-frame"}
      role={layout.compact ? undefined : "presentation"}
      aria-label={layout.compact ? uiText("Menu di navigazione") : undefined}
      onCancel={(event) => {
        if (event.target !== event.currentTarget || !layout.compact) return;
        event.preventDefault();
        layout.hide();
      }}
      onClick={(event) => {
        if (layout.compact && event.target === event.currentTarget)
          layout.hide();
      }}
    >
      <aside
        id="workspace-navigation"
        className="workspace-rail"
        aria-label={uiText("Navigazione principale")}
      >
        {children}
      </aside>
    </dialog>
  );
}
