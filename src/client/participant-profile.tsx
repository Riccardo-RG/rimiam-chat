"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  changeOwnProfileSchema,
  participantProfileSchema,
  type ParticipantProfile,
} from "../contracts/participant-profile";
import { api, errorText } from "./api";
import { IdentityImage } from "./identity-photos";
import { initials } from "./conversation-presentation";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./participant-profile.module.css";

type ProfileProps = {
  path: string;
  person: string;
  name: string;
  photo?: string;
  editable?: boolean;
  photoEditor?: ReactNode;
};

export function ProfileLink(
  props: ProfileProps & { children: ReactNode; label?: string },
) {
  const { t: uiText } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={opener}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-label={
          props.label ?? uiText("Apri il profilo di {0}", String(props.name))
        }
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        {props.children}
      </button>
      {open &&
        createPortal(
          <ProfileCard
            key={props.path + props.person}
            {...props}
            dismiss={() => {
              setOpen(false);
              const closedMenu = opener.current?.closest("details:not([open])");
              // Native dialog restores focus. Supply a visible fallback only when
              // its opener was hidden by outside dismissal of the account menu.
              if (closedMenu && document.activeElement === document.body)
                closedMenu
                  .querySelector("summary")
                  ?.focus({ preventScroll: true });
            }}
          />,
          document.body,
        )}
    </>
  );
}

function ProfileCard({
  path,
  person,
  name,
  photo,
  editable,
  photoEditor,
  dismiss,
}: ProfileProps & { dismiss: () => void }) {
  const { t: uiText } = useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useId();
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const draftVersion = useRef<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let request: AbortController | undefined;
    async function read() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const value = participantProfileSchema.parse(
          await api(path, undefined, controller.signal),
        );
        if (value.id !== person) throw new Error("PROFILE_NOT_AVAILABLE");
        if (!controller.signal.aborted) {
          setProfile(value);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setProfile(null);
          setError(
            e instanceof Error && e.message === "NETWORK_UNAVAILABLE"
              ? errorText(e)
              : uiText("Il profilo non è disponibile in questa conversazione."),
          );
        }
      }
    }
    void read();
    const restore = () => {
      if (!document.hidden && !saving.current) void read();
    };
    document.addEventListener("visibilitychange", restore);
    return () => {
      request?.abort();
      document.removeEventListener("visibilitychange", restore);
    };
  }, [path, person, refresh, uiText]);

  async function save() {
    if (!profile || !editable || saving.current) return;
    const parsed = changeOwnProfileSchema.safeParse({
      expectedActorId: person,
      expectedVersion: draftVersion.current ?? profile.version,
      phone: draft?.trim() || null,
    });
    if (!parsed.success) {
      setNotice(
        uiText(
          "Inserisci un numero con 6–15 cifre, oppure lascia il campo vuoto.",
        ),
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setNotice("");
    try {
      const updated = participantProfileSchema.parse(
        await api(path, parsed.data),
      );
      if (updated.id !== person) throw new Error("AUTH_CONTEXT_CHANGED");
      setProfile(updated);
      setDraft(null);
      draftVersion.current = null;
      setNotice(
        updated.phone ? uiText("Numero salvato.") : uiText("Numero rimosso."),
      );
    } catch (e) {
      if (e instanceof Error && e.message === "PROFILE_VERSION_CHANGED") {
        setDraft(null);
        draftVersion.current = null;
        setNotice(
          uiText(
            "Il profilo è cambiato. Controlla il numero aggiornato prima di modificarlo.",
          ),
        );
      } else setNotice(errorText(e));
      setRefresh((v) => v + 1);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.card}
      aria-labelledby={heading}
      onClose={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.stopPropagation();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          dialog.current?.close();
      }}
    >
      <header>
        <span>{uiText("Profilo")}</span>
        <button
          type="button"
          className="quiet"
          onClick={() => dialog.current?.close()}
        >
          {uiText("Chiudi ")}
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <div className={styles.identity}>
        <IdentityImage
          className={styles.portrait}
          url={profile ? photo : undefined}
          fallback={initials(name)}
          profileName={name}
        />
        <h2 id={heading}>{profile?.name ?? name}</h2>
      </div>
      {profile ? (
        <>
          {editable && photoEditor}
          <dl>
            <dt>{uiText("Email")}</dt>
            <dd>
              <a href={"mailto:" + profile.email}>{profile.email}</a>
            </dd>
            {!editable && profile.phone && (
              <>
                <dt>{uiText("Telefono")}</dt>
                <dd>
                  <a href={"tel:" + profile.phone.replace(/[^\d+]/g, "")}>
                    {profile.phone}
                  </a>
                </dd>
              </>
            )}
          </dl>
          {editable && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                {uiText("Telefono (facoltativo)")}
                <input
                  type="tel"
                  autoComplete="tel"
                  disabled={busy}
                  maxLength={32}
                  value={draft ?? profile.phone ?? ""}
                  onChange={(e) => {
                    draftVersion.current ??= profile.version;
                    setDraft(e.target.value);
                    setNotice("");
                  }}
                />
              </label>
              <small>
                {uiText(
                  "Chi condivide uno spazio o una chat privata con te può vedere la tua email e il numero che scegli di aggiungere.",
                )}
              </small>
              <button
                type="submit"
                disabled={
                  busy ||
                  draft === null ||
                  draft.trim() === (profile.phone ?? "")
                }
              >
                {busy ? uiText("Salvataggio…") : uiText("Salva numero")}
              </button>
              {notice && <p role="status">{notice}</p>}
            </form>
          )}
        </>
      ) : error ? (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="quiet"
            onClick={() => setRefresh((v) => v + 1)}
          >
            {uiText("Riprova")}
          </button>
        </>
      ) : (
        <p role="status">{uiText("Caricamento del profilo…")}</p>
      )}
    </dialog>
  );
}
