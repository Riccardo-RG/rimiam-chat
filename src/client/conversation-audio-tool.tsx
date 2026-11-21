"use client";
import { useUiLanguage } from "./ui-language";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { WorkspaceIcon } from "./workspace-icon";

export function ConversationAudioTool({
  icon,
  title,
  status,
  onClose,
  children,
}: {
  icon: "microphone" | "phone";
  title: string;
  status?: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  const { t: uiText } = useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (host && !dialog.current?.open) dialog.current?.showModal();
  }, [host]);
  return (
    <>
      <button
        type="button"
        className="quiet composer-audio"
        data-audio-status={status || undefined}
        aria-haspopup="dialog"
        aria-controls={id}
        aria-label={status ? title + " · " + status : title}
        title={title}
        onClick={() => {
          if (dialog.current) dialog.current.showModal();
          else setHost(document.body);
        }}
      >
        <WorkspaceIcon name={icon} />
        {status && <span role="status">{status}</span>}
      </button>
      {host &&
        createPortal(
          <dialog
            id={id}
            ref={dialog}
            className="composer-audio-dialog"
            aria-labelledby={id + "-title"}
            onClose={onClose}
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              const { left, right, top, bottom } =
                event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < left ||
                event.clientX > right ||
                event.clientY < top ||
                event.clientY > bottom
              )
                event.currentTarget.close();
            }}
          >
            <header>
              <h2 id={id + "-title"}>{title}</h2>
              <button
                type="button"
                className="quiet"
                onClick={() => dialog.current?.close()}
              >
                <WorkspaceIcon name="close" />
                {uiText(" Chiudi")}
              </button>
            </header>
            <div className="composer-audio-body">{children}</div>
          </dialog>,
          host,
        )}
    </>
  );
}
