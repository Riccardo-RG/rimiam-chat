"use client";
import { useUiLanguage } from "./ui-language";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AttachmentPreview } from "../contracts/attachment-preview";
import { attachmentSize } from "../shared/attachment-size";
import { api, errorText } from "./api";
import styles from "./file-preview.module.css";

function AudioPreview({ path, filename }: { path: string; filename: string }) {
  const { t: uiText } = useUiLanguage();
  const player = useRef<HTMLAudioElement>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const audio = player.current;
    return () => {
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, []);
  function listen() {
    const audio = player.current;
    if (!audio) return;
    setError(false);
    setOpened(true);
    audio.src = path + (path.includes("?") ? "&" : "?") + "view=audio";
    void audio.play().catch(() => {
      if (player.current === audio) setError(true);
    });
  }
  return (
    <>
      {!opened && (
        <button type="button" className="quiet" onClick={listen}>
          {uiText("Ascolta anteprima")}
        </button>
      )}
      <audio
        ref={player}
        hidden={!opened}
        controls
        preload="none"
        aria-label={uiText("Ascolta {0}", String(filename))}
        onError={() => setError(true)}
        onPlaying={() => setError(false)}
      />
      {error && (
        <p role="status">
          {uiText("Riproduzione non disponibile. Puoi scaricare l’originale.")}
        </p>
      )}
    </>
  );
}

export function FilePreviewBody({
  path,
  original,
}: {
  path: string;
  original: string;
}) {
  const { t: uiText } = useUiLanguage();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    path: string;
    value?: AttachmentPreview;
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    api<AttachmentPreview>(
      path + (path.includes("?") ? "&" : "?") + "view=preview",
      undefined,
      c.signal,
    )
      .then((value) => {
        if (!c.signal.aborted) setResult({ path, value });
      })
      .catch((e) => {
        if (!c.signal.aborted) setResult({ path, error: errorText(e) });
      });
    return () => c.abort();
  }, [path, attempt]);
  const current = result?.path === path ? result : undefined,
    file = current?.value;
  if (current?.error)
    return (
      <p role="alert">
        {current.error}{" "}
        <button
          type="button"
          className="quiet"
          onClick={() => setAttempt((n) => n + 1)}
        >
          {uiText("Riprova")}
        </button>
      </p>
    );
  if (!file) return <p role="status">{uiText("Apertura anteprima…")}</p>;
  const { preview } = file;
  return (
    <div className={styles.body}>
      <small>
        {file.mediaType.split(";")[0]} · {attachmentSize(file.bytes)}
      </small>
      {preview.kind === "image" && (
        <Image
          unoptimized
          src={original}
          alt={file.filename}
          width={900}
          height={640}
        />
      )}
      {preview.kind === "page" && (
        <figure>
          <Image
            unoptimized
            src={"data:image/jpeg;base64," + preview.jpeg}
            alt={uiText("Prima pagina di {0}", String(file.filename))}
            width={900}
            height={1000}
          />
          <figcaption>{uiText("Prima pagina")}</figcaption>
        </figure>
      )}
      {preview.kind === "audio" && (
        <AudioPreview key={path} path={path} filename={file.filename} />
      )}
      {preview.kind === "text" && (
        <>
          <pre>{preview.text}</pre>
          {preview.truncated && (
            <small>
              {uiText(
                "Estratto iniziale. Scarica il file per leggere il resto.",
              )}
            </small>
          )}
        </>
      )}
      {preview.kind === "unavailable" && (
        <p>
          {preview.reason === "busy"
            ? uiText("Il lettore è occupato.")
            : preview.reason === "unreadable"
              ? uiText("L’anteprima di questo file non è disponibile.")
              : uiText("Questo formato non ha un’anteprima.")}{" "}
          {preview.reason === "busy" && (
            <button
              type="button"
              className="quiet"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {uiText("Riprova")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
export function FilePreviewButton({
  name,
  path,
  original,
  children,
  onMessage,
}: {
  name: string;
  path: string;
  original: string;
  children: ReactNode;
  onMessage?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [open, setOpen] = useState(false),
    trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    heading = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    node.showModal();
    return () => {
      if (node.open) node.close();
    };
  }, [open]);
  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={uiText("Apri anteprima di {0}", String(name))}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-labelledby={heading}
          className={styles.dialog}
          onCancel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            close();
          }}
          onClose={(e) => e.stopPropagation()}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className={styles.wrap}>
            <header>
              <strong id={heading}>{name}</strong>
              <button type="button" className="quiet" onClick={close}>
                {uiText("Chiudi")}
              </button>
            </header>
            <FilePreviewBody path={path} original={original} />
            <footer>
              <a href={original} download={name}>
                {uiText("Scarica originale")}
              </a>
              {onMessage && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    close();
                    onMessage();
                  }}
                >
                  {uiText("Vai al messaggio")}
                </button>
              )}
            </footer>
          </div>
        </dialog>
      )}
    </>
  );
}
