"use client";
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import styles from "./workspace-layer.module.css";

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
  suspended = false,
}: {
  title: string;
  children?: ReactNode;
  close: () => void;
  docked?: boolean;
  setDocked?: (docked: boolean) => void;
  suspended?: boolean;
}) {
  const compact = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const presentationCloses = useRef(0);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const modal = compact || !docked;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Keep one DOM tree when presentation changes so local form drafts survive.
    if (element.open) {
      presentationCloses.current++;
      element.close();
    }
    if (suspended) return;
    const prior = document.activeElement as HTMLElement | null;
    if (modal) element.showModal();
    else {
      element.show();
      heading.current?.focus();
    }
    return () => {
      prior?.focus();
    };
  }, [modal, suspended]);
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
  return (
    <dialog
      ref={dialog}
      className={`workspace-layer ${modal ? "layer-dialog" : styles.inline}`}
      aria-labelledby={headingId}
      onCancel={close}
      onClose={() => {
        if (presentationCloses.current) presentationCloses.current--;
        else if (!suspended) close();
      }}
    >
      {content}
    </dialog>
  );
}
