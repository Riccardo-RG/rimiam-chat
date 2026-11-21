"use client";

import type { Command } from "../contracts/commands";
import type { PhotoDirectory } from "../contracts/identity-photos";
import type { Snapshot } from "../contracts/web-snapshot";
import { localizedDate } from "../shared/i18n/date";
import { invitationDeliveryLabel } from "../shared/invitation-delivery";
import { initials } from "./conversation-presentation";
import { IdentityImage, photoUrl } from "./identity-photos";
import { ProfileLink } from "./participant-profile";
import { useUiLanguage } from "./ui-language";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./workspace-people.module.css";

const date = localizedDate({ dateStyle: "short", timeStyle: "short" });

export function WorkspacePeople({
  state,
  actor,
  photos,
  access,
  busy,
  invite,
  submit,
}: {
  state: Snapshot;
  actor: string;
  photos: PhotoDirectory | null;
  access?: Snapshot["access"][number];
  busy: boolean;
  invite: () => void;
  submit: (command: Command) => void;
}) {
  const { t, locale } = useUiLanguage();
  const workspace = state.workspace.id;
  const invitations = state.invitations.filter(
    (i) => !i.accepted_at && !i.revoked_at,
  );
  return (
    <section
      className={styles.directory}
      aria-label={t("Partecipanti e accesso")}
    >
      <div className={styles.heading}>
        <h3>
          {t("Partecipanti")}{" "}
          <span>{state.members.filter((m) => m.active).length}</span>
        </h3>
        {access?.invitations && (
          <button
            className="quiet"
            type="button"
            aria-haspopup="dialog"
            onClick={invite}
          >
            <WorkspaceIcon name="invite" /> {t("Invita una persona")}
          </button>
        )}
      </div>
      <ul className={styles.list}>
        {state.members.map((member) => {
          const { user_id: id, name, active } = member;
          const photo = active
            ? photoUrl(photos?.members[id], workspace, id)
            : undefined;
          const canRemove =
            access?.remove_members &&
            active &&
            id !== actor &&
            !state.access.some((a) => a.holder_id === id && a.active);
          return (
            <li className={styles.row} key={id}>
              <IdentityImage
                className={styles.avatar}
                profileName={name}
                fallback={initials(name)}
                url={photo}
              />
              <div className={styles.copy}>
                {active ? (
                  <ProfileLink
                    path={`/api/v1/workspaces/${workspace}/profiles/${encodeURIComponent(id)}`}
                    person={id}
                    name={name}
                    photo={photo}
                  >
                    {name}
                  </ProfileLink>
                ) : (
                  <strong>{name}</strong>
                )}
                <small>
                  {id === actor
                    ? t("Tu")
                    : active
                      ? t("Partecipante")
                      : t("Non ha più accesso")}
                </small>
              </div>
              {canRemove && (
                <details className={styles.memberActions}>
                  <summary
                    title={t("Opzioni per {0}", name)}
                    aria-label={t("Opzioni per {0}", name)}
                  >
                    <WorkspaceIcon name="more" />
                  </summary>
                  <button
                    type="button"
                    className="quiet danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          t(
                            "Rimuovere l’accesso di {0}? Storia e impegni restano conservati.",
                            name,
                          ),
                        )
                      ) {
                        submit({
                          type: "member.remove",
                          personId: id,
                          expectedAccessRevision:
                            state.workspace.access_revision,
                          confirmed: true,
                        });
                      }
                    }}
                  >
                    {t("Rimuovi accesso")}
                  </button>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {invitations.length > 0 && (
        <section className={styles.invitations} aria-label={t("Inviti")}>
          <h3>
            {t("Inviti")} <span>{invitations.length}</span>
          </h3>
          <ul className={styles.list}>
            {invitations.map((invitation) => (
              <li key={invitation.id} className={styles.row}>
                <span aria-hidden="true" className={styles.inviteMark}>
                  <WorkspaceIcon name="mail" />
                </span>
                <div className={styles.copy}>
                  <strong>
                    {invitation.recipient_name || invitation.recipient_email}
                  </strong>
                  <small>
                    {t("Scade il ")}
                    <time dateTime={invitation.expires_at}>
                      {date(locale).format(new Date(invitation.expires_at))}
                    </time>
                  </small>
                  <details className={styles.delivery}>
                    <summary>{t("Dettagli invito")}</summary>
                    <p>
                      {t(invitationDeliveryLabel(invitation.delivery_status))}
                    </p>
                    {access?.invitations && (
                      <button
                        type="button"
                        className="quiet"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              t(
                                "Revocare l’invito a {0}?",
                                invitation.recipient_name ||
                                  invitation.recipient_email,
                              ),
                            )
                          ) {
                            submit({
                              type: "invitation.revoke",
                              invitationId: invitation.id,
                            });
                          }
                        }}
                      >
                        {t("Revoca invito")}
                      </button>
                    )}
                  </details>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
