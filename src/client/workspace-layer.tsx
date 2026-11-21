"use client";
import { useUiLanguage } from "./ui-language";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import styles from "./workspace-layer.module.css";
import { WorkspaceIcon } from "./workspace-icon";

export type DocumentExitGuard = (leave: () => void) => boolean;

const query = "(max-width: 760px)";
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
  expanded = false,
  setExpanded,
  suspended = false,
  invitation = false,
  openDirectory,
  back,
  contextName,
  documentExitGuard,
}: {
  title: string;
  children?: ReactNode;
  close: () => void;
  docked?: boolean;
  setDocked?: (docked: boolean) => void;
  expanded?: boolean;
  setExpanded?: (expanded: boolean) => void;
  suspended?: boolean;
  invitation?: boolean;
  openDirectory?: () => void;
  back?: { label: string; open: () => void };
  contextName?: string;
  documentExitGuard?: RefObject<DocumentExitGuard | null>;
}) {
  const { t: uiText } = useUiLanguage();
  const compact = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const presentationCloses = useRef(0);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const modal = compact || !docked;
  useLayoutEffect(() => {
    const opener = document.activeElement;
    if (
      opener instanceof HTMLElement &&
      opener !== document.body &&
      !dialog.current?.contains(opener)
    )
      returnFocus.current = opener;
  }, [title, modal, suspended]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Keep one DOM tree when presentation changes so local form drafts survive.
    if (element.open) {
      presentationCloses.current++;
      element.close();
    }
    if (suspended) return;
    if (modal) element.showModal();
    else {
      element.show();
      heading.current?.focus();
    }
    return () => {
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, [modal, suspended]);
  useEffect(() => {
    if (suspended) return;
    const firstField = invitation
      ? dialog.current?.querySelector<HTMLInputElement>(
          ".invitation-flow input",
        )
      : null;
    (firstField ?? heading.current)?.focus();
  }, [title, invitation, suspended]);
  function requestExit(leave: () => void) {
    if (!documentExitGuard?.current?.(leave)) leave();
  }
  const content = (
    <>
      <header className={`layer-header ${styles.header}`}>
        {back && (
          <button
            type="button"
            className="icon-button"
            aria-label={back.label}
            title={back.label}
            onClick={() => requestExit(back.open)}
          >
            <WorkspaceIcon name="arrow" className={styles.backArrow} />
          </button>
        )}
        {openDirectory && (
          <button
            type="button"
            className="icon-button"
            onClick={() => requestExit(openDirectory)}
            aria-label={uiText("Viste dello spazio")}
            title={uiText("Viste dello spazio")}
          >
            <WorkspaceIcon name="menu" />
          </button>
        )}
        <div className={styles.title}>
          {contextName && <span title={contextName}>{contextName}</span>}
          <h2 ref={heading} tabIndex={-1} id={headingId}>
            {title}
          </h2>
        </div>
        {setExpanded && (
          <button
            type="button"
            className={`quiet ${styles.resize}`}
            aria-pressed={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? uiText("Riduci") : uiText("Allarga")}
          </button>
        )}
        {!compact && setDocked && (
          <button
            type="button"
            className="quiet"
            onClick={() => setDocked(!docked)}
          >
            {docked ? uiText("Sgancia") : uiText("Affianca")}
          </button>
        )}
        <button
          type="button"
          className="icon-button dialog-close"
          aria-label={uiText("Torna alla conversazione")}
          title={uiText("Torna alla conversazione")}
          onClick={() => requestExit(close)}
        >
          {uiText("Chiudi ")}
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <div className="layer-body">{children}</div>
    </>
  );
  return (
    <dialog
      ref={dialog}
      className={`workspace-layer ${modal ? "layer-dialog" : styles.inline}${invitation ? " invitation-dialog" : ""}`}
      aria-labelledby={headingId}
      data-expanded={expanded || undefined}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        requestExit(close);
      }}
      onKeyDown={(event) => {
        if (
          !modal &&
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.target instanceof Element &&
          event.target.closest("dialog") === event.currentTarget
        ) {
          event.preventDefault();
          event.stopPropagation();
          requestExit(close);
        }
      }}
      onClose={(event) => {
        if (event.target !== event.currentTarget) return;
        if (presentationCloses.current) presentationCloses.current--;
        else if (!suspended) close();
      }}
    >
      {content}
    </dialog>
  );
}
