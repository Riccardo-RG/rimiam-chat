"use client";
import { useUiLanguage } from "./ui-language";

import NextImage from "next/image";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  photoDirectorySchema,
  type PhotoDirectory,
} from "../contracts/identity-photos";
import { api } from "./api";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./identity-photos.module.css";

const endpoint = "/api/v1/identity-photos";
const changedEvent = "rimiam-identity-photos-changed";

export function useIdentityPhotos(
  actor?: string,
  workspace?: string,
  revision = 0,
) {
  const key = actor ? JSON.stringify([actor, workspace]) : "";
  const [state, setState] = useState<{
    key: string;
    directory: PhotoDirectory;
  } | null>(null);
  useEffect(() => {
    if (!key) return;
    let pending: AbortController | undefined;
    async function refresh() {
      pending?.abort();
      const request = new AbortController();
      pending = request;
      try {
        const query = workspace ? "?" + new URLSearchParams({ workspace }) : "";
        const directory = photoDirectorySchema.parse(
          await api(endpoint + query, undefined, request.signal),
        );
        if (!request.signal.aborted && directory.actor === actor)
          setState({ key, directory });
      } catch {
        if (!request.signal.aborted) setState(null);
      }
    }
    void refresh();
    window.addEventListener(changedEvent, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      pending?.abort();
      window.removeEventListener(changedEvent, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [actor, workspace, key, revision]);
  return state?.key === key ? state.directory : null;
}
export function photoUrl(
  v: { version: number; present: boolean } | undefined,
  workspace?: string,
  person?: string,
) {
  if (!v?.present) return;
  const q = new URLSearchParams({ image: "1", v: String(v.version) });
  if (workspace) q.set("workspace", workspace);
  if (person) q.set("person", person);
  return endpoint + "?" + q;
}
export function IdentityImage({
  url,
  fallback,
  className,
  profileName,
}: {
  url?: string;
  fallback?: ReactNode;
  className?: string;
  profileName?: string;
}) {
  const [failed, setFailed] = useState<string>();
  const imageClass = `identity-image ${className ?? ""}`;
  const image =
    url && failed !== url ? (
      <NextImage
        unoptimized
        alt=""
        src={url}
        onError={() => setFailed(url)}
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
      />
    ) : (
      fallback
    );
  if (profileName && url && failed !== url)
    return (
      <ProfileThumbnail
        key={url}
        url={url}
        name={profileName}
        className={imageClass}
      >
        {image}
      </ProfileThumbnail>
    );
  return (
    <span className={imageClass} aria-hidden="true">
      {image}
    </span>
  );
}

function ProfileThumbnail({
  url,
  name,
  className,
  children,
}: {
  url: string;
  name: string;
  className: string;
  children: ReactNode;
}) {
  const { t: uiText } = useUiLanguage();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`${className} ${styles.trigger}`}
        aria-label={uiText("Apri la foto di {0}", String(name))}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <PhotoPreview url={url} name={name} dismiss={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}

function PhotoPreview({
  url,
  name,
  dismiss,
}: {
  url: string;
  name: string;
  dismiss: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  return (
    <dialog
      className={styles.preview}
      ref={dialog}
      aria-labelledby={heading}
      onClose={dismiss}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <header>
        <h2 id={heading}>
          {uiText("Foto di ")}
          {name}
        </h2>
        <button
          type="button"
          className="quiet"
          onClick={() => dialog.current?.close()}
        >
          {uiText("Chiudi ")}
          <WorkspaceIcon name="close" />
        </button>
      </header>
      {failed ? (
        <p role="status">{uiText("La foto non è disponibile.")}</p>
      ) : (
        <NextImage
          alt={uiText("Foto del profilo di {0}", String(name))}
          src={url}
          unoptimized
          width={256}
          height={256}
          onError={() => setFailed(true)}
        />
      )}
    </dialog>
  );
}
async function encodePhoto(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 12 * 1024 * 1024
  )
    throw Error("FORMAT");
  const picture = new Image(),
    url = URL.createObjectURL(file);
  try {
    picture.src = url;
    await picture.decode();
    const size = Math.min(picture.naturalWidth, picture.naturalHeight);
    if (!size || picture.naturalWidth * picture.naturalHeight > 40000000)
      throw Error("FORMAT");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 384;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("FORMAT");
    ctx.fillStyle = "#eeeae7";
    ctx.fillRect(0, 0, 384, 384);
    ctx.drawImage(
      picture,
      (picture.naturalWidth - size) / 2,
      (picture.naturalHeight - size) / 2,
      size,
      size,
      0,
      0,
      384,
      384,
    );
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function IdentityPhotoEditor({
  actor,
  workspace,
  version,
  present,
  available,
}: {
  actor: string;
  workspace?: string;
  version: number;
  present: boolean;
  available: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [removing, setRemoving] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const label = workspace
    ? uiText("Foto dello spazio")
    : uiText("Foto del profilo");
  async function change(selected: File | null) {
    if (busy || !available) return;
    setBusy(true);
    setMessage("");
    try {
      const image = selected ? await encodePhoto(selected) : null;
      await api(endpoint, {
        expectedActorId: actor,
        expectedVersion: version,
        ...(workspace ? { workspace } : {}),
        image,
      });
      setRemoving(false);
      setMessage(selected ? "Foto aggiornata." : "Foto rimossa.");
      window.dispatchEvent(new Event(changedEvent));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      setMessage(
        reason === "PHOTO_VERSION_CHANGED"
          ? "La foto è cambiata. Controllala e riprova."
          : reason === "FORMAT" || reason === "INVALID_PHOTO"
            ? "Scegli un’immagine JPEG, PNG o WebP fino a 12 MB."
            : reason === "WORKSPACE_ACCESS_DENIED"
              ? "Non hai più accesso alla modifica della foto."
              : "Impossibile aggiornare la foto. Riprova.",
      );
      window.dispatchEvent(new Event(changedEvent));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  return (
    <div className="identity-photo-editor">
      <span className="identity-photo-label">{label}</span>
      <div>
        <button
          disabled={busy || !available}
          type="button"
          className={`quiet ${styles.photoAction}`}
          onClick={() => file.current?.click()}
        >
          <WorkspaceIcon name="image" />
          {busy
            ? uiText("Salvataggio…")
            : present
              ? uiText("Cambia foto")
              : uiText("Aggiungi foto")}
        </button>
        {present && !removing && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            {uiText("Rimuovi")}
          </button>
        )}
        {removing && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void change(null)}
            >
              {uiText("Conferma rimozione")}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => setRemoving(false)}
            >
              {uiText("Annulla")}
            </button>
          </>
        )}
      </div>
      <input
        aria-label={label}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        ref={file}
        onChange={(e) => {
          const item = e.target.files?.[0];
          if (item) void change(item);
        }}
      />
      {message && <small role="status">{message}</small>}
    </div>
  );
}
