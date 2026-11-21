"use client";
import { useUiLanguage } from "./ui-language";

import Link from "next/link";
import { AppearanceControl } from "./appearance-control";
import { calendarConnectionLabel } from "./calendar-connection-label";
import { initials } from "./conversation-presentation";
import { IdentityImage, IdentityPhotoEditor } from "./identity-photos";
import type { PhotoDirectory } from "../contracts/identity-photos";
import { ProfileLink } from "./participant-profile";
import { WorkspaceIcon } from "./workspace-icon";

export function AccountMenu({
  user,
  returnTo,
  photo,
  photos,
  busy,
  calendarLinked,
  onCalendars,
  onSignOut,
}: {
  user: { id: string; name: string; emailVerified: boolean };
  returnTo: string;
  photo?: string;
  photos: PhotoDirectory | null;
  busy: boolean;
  calendarLinked: boolean | null | undefined;
  onCalendars: () => void;
  onSignOut: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const identity = (
    <>
      <IdentityImage
        className="account-portrait"
        url={photo}
        fallback={initials(user.name)}
      />
      <span className="account-identity-text">
        <strong>{user.name}</strong>
        {user.emailVerified && <small>{uiText("Il mio profilo")}</small>}
      </span>
    </>
  );
  return (
    <div className="account-options">
      <div className="account-identity">
        {user.emailVerified ? (
          <ProfileLink
            path="/api/v1/profile"
            person={user.id}
            name={user.name}
            photo={photo}
            editable
            label={uiText("Il mio profilo")}
            photoEditor={
              <IdentityPhotoEditor
                actor={user.id}
                version={photos?.own.version ?? 0}
                present={!!photo}
                available={!!photos}
              />
            }
          >
            {identity}
          </ProfileLink>
        ) : (
          identity
        )}
        <button
          type="button"
          className="account-close"
          aria-label={uiText("Chiudi menu account")}
          title={uiText("Chiudi")}
          onClick={(event) => {
            const menu = event.currentTarget.closest("details");
            if (menu) {
              menu.open = false;
              menu.querySelector("summary")?.focus({ preventScroll: true });
            }
          }}
        >
          <WorkspaceIcon name="close" />
        </button>
      </div>
      <Link
        className="account-option"
        href={`/account/access?returnTo=${encodeURIComponent(returnTo)}`}
      >
        <WorkspaceIcon name="key" />
        <span>
          {uiText("Metodi di accesso")}
          <small>{uiText("Google e Microsoft")}</small>
        </span>
      </Link>
      {user.emailVerified && (
        <button
          type="button"
          className="account-option"
          onClick={(event) => {
            const menu = event.currentTarget.closest("details");
            if (menu) menu.open = false;
            onCalendars();
          }}
        >
          <WorkspaceIcon name="calendar" />{" "}
          {uiText(calendarConnectionLabel(calendarLinked))}
        </button>
      )}
      <details className="account-appearance">
        <summary className="account-option">
          <WorkspaceIcon name="theme" />
          {uiText(" Aspetto")}
          <WorkspaceIcon name="chevron" />
        </summary>
        <div>
          <AppearanceControl showAccent />
        </div>
      </details>
      <div className="account-secondary">
        <Link
          href="/beta"
          target="_blank"
          rel="noopener noreferrer"
          className="account-option"
        >
          <WorkspaceIcon name="guide" />
          {uiText(" Regole della beta")}
        </Link>
        <button
          className="account-option"
          type="button"
          disabled={busy}
          onClick={onSignOut}
        >
          <WorkspaceIcon name="signout" />
          {uiText(" Esci dall’account")}
        </button>
      </div>
    </div>
  );
}
