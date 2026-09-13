"use client";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

const query = "(max-width: 1100px)";
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
export function WorkspaceLayer({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const compact = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    if (compact) dialog.current?.showModal();
    else heading.current?.focus();
    return () => {
      prior?.focus();
    };
  }, [compact]);
  const content = (
    <>
      <header className="layer-header">
        <div>
          <p className="eyebrow">NELLO SPAZIO</p>
          <h2 ref={heading} tabIndex={-1} id="workspace-layer-title">
            {title}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Torna alla conversazione"
          onClick={close}
        >
          ✕
        </button>
      </header>
      <div className="layer-body">{children}</div>
    </>
  );
  return compact ? (
    <dialog
      ref={dialog}
      className="workspace-layer layer-dialog"
      aria-labelledby="workspace-layer-title"
      onCancel={close}
      onClose={close}
    >
      {content}
    </dialog>
  ) : (
    <aside className="workspace-layer" aria-labelledby="workspace-layer-title">
      {content}
    </aside>
  );
}
