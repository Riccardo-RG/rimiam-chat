"use client";
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

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
  docked = false,
  setDocked,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  docked?: boolean;
  setDocked?: (docked: boolean) => void;
}) {
  const compact = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const modal = compact || !docked;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    if (modal) dialog.current?.showModal();
    else heading.current?.focus();
    return () => {
      prior?.focus();
    };
  }, [modal]);
  const content = (
    <>
      <header className="layer-header">
        <div>
          <p className="eyebrow">LO SPAZIO</p>
          <h2 ref={heading} tabIndex={-1} id={headingId}>
            {title}
          </h2>
        </div>
        {!compact && setDocked && (
          <button
            type="button"
            className="quiet"
            onClick={() => setDocked(!docked)}
          >
            {docked ? "Sgancia" : "Affianca"}
          </button>
        )}
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
  return modal ? (
    <dialog
      ref={dialog}
      className="workspace-layer layer-dialog"
      aria-labelledby={headingId}
      onCancel={close}
      onClose={close}
    >
      {content}
    </dialog>
  ) : (
    <aside className="workspace-layer" aria-labelledby={headingId}>
      {content}
    </aside>
  );
}
