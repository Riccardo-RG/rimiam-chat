import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { AccessView } from "../../../src/contracts/access";
import type { PhotoDirectory } from "../../../src/contracts/identity-photos";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { Command } from "../../../src/contracts/commands";
import { invitationDeliveryLabel } from "../../../src/shared/invitation-delivery";
import { HomeAvatar, memberPhotoPath } from "../AppShell";
import { StudioIcon } from "../StudioIcon";
import { type NativeRequest } from "../api";
import { useUiLanguage } from "../i18n";
import { Action, usePalette } from "../ui";
import { useResource } from "../useResource";
import { canRemoveMember } from "./access-controls";
import { ToolRow } from "./ToolLayout";

export function PeopleDirectory({
  request,
  path,
  actor,
  snapshot,
  photos,
  busy,
  send,
  onPerson,
  onInvite,
}: {
  request: NativeRequest;
  path: string;
  actor: string;
  snapshot: Snapshot;
  photos?: PhotoDirectory;
  busy: boolean;
  send: (label: string, command: Command) => void;
  onPerson: (id: string, name: string) => void;
  onInvite: () => void;
}) {
  const { t, locale } = useUiLanguage();
  const c = usePalette();
  const holdsAccess = snapshot.access.some(
    (r) => r.active && r.holder_id === actor,
  );
  const access = useResource<AccessView>(
    request,
    path + "/access",
    0,
    holdsAccess,
  );
  const [detail, setDetail] = useState<string | null>(null);
  const { members, workspace } = snapshot;
  const people = members.filter((m) => m.active);
  const revision = access.value?.accessRevision;
  const authorizations = access.value?.relationships ?? [];
  const own = authorizations.filter((r) => r.active && r.holderId === actor);
  const canInvite = own.some((r) => r.available && r.invitations);
  const invites = snapshot.invitations.filter(
    (i) => !i.revoked_at && !i.accepted_at,
  );
  const title = { color: c.text, fontSize: 17, fontWeight: "700" as const };
  const separator = {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: c.line,
  };
  const toggle = (id: string) => setDetail(detail === id ? null : id);

  function confirm(label: string, message: string, command: Command) {
    Alert.alert(label, message, [
      { text: t("Annulla"), style: "cancel" },
      {
        text: t("Conferma"),
        style: "destructive",
        onPress: () => send(label, command),
      },
    ]);
  }

  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <Text accessibilityRole="header" style={[title, { flexGrow: 1 }]}>
          {t("Partecipanti")} · {people.length}
        </Text>
        {canInvite && (
          <Action
            label={t("Invita una persona")}
            variant="outline"
            onPress={onInvite}
          />
        )}
      </View>
      <View>
        {people.map((member) => (
          <View key={member.user_id} style={separator}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Apri il profilo di {0}", member.name)}
                onPress={() => onPerson(member.user_id, member.name)}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: 56,
                  gap: 12,
                  paddingVertical: 6,
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <HomeAvatar
                  request={request}
                  name={member.name}
                  size={40}
                  path={memberPhotoPath(photos, workspace.id, member.user_id)}
                />
                <Text
                  style={{
                    color: c.text,
                    fontSize: 16,
                    fontWeight: "600",
                    flexShrink: 1,
                  }}
                >
                  {member.name}
                </Text>
                {member.user_id === actor && (
                  <Text style={{ color: c.muted }}>{t("Tu")}</Text>
                )}
              </Pressable>
              {canRemoveMember(authorizations, actor, member.user_id) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: detail === member.user_id }}
                  accessibilityLabel={t("Opzioni per {0}", member.name)}
                  onPress={() => toggle(member.user_id)}
                  style={{
                    width: 48,
                    minHeight: 48,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <StudioIcon name="more" size={20} color={c.muted} />
                </Pressable>
              )}
            </View>
            {detail === member.user_id &&
              revision !== undefined &&
              canRemoveMember(authorizations, actor, member.user_id) && (
                <Action
                  variant="quiet"
                  disabled={busy}
                  label={t("Rimuovi accesso di {0}", member.name)}
                  onPress={() =>
                    confirm(
                      t("Rimuovi {0}", member.name),
                      t(
                        "Perderà l’accesso allo spazio. Storia e impegni restano conservati.",
                      ),
                      {
                        type: "member.remove",
                        personId: member.user_id,
                        expectedAccessRevision: revision,
                        confirmed: true,
                      },
                    )
                  }
                />
              )}
          </View>
        ))}
      </View>
      {canInvite && invites.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={title}>
            {t("Inviti")} · {invites.length}
          </Text>
          {invites.map((invite) => {
            const expired = new Date(invite.expires_at).getTime() <= Date.now();
            const recipient = invite.recipient_name || invite.recipient_email;
            return (
              <View key={invite.id} style={[separator, { paddingVertical: 6 }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: detail === invite.id }}
                  accessibilityLabel={t("Dettagli invito") + " · " + recipient}
                  onPress={() => toggle(invite.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: 48,
                    gap: 8,
                  }}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{ color: c.text, fontWeight: "600", fontSize: 16 }}
                    >
                      {recipient}
                    </Text>
                    <Text style={{ color: c.muted }}>
                      {t(
                        expired
                          ? "Invito scaduto"
                          : "In attesa di accettazione",
                      )}
                    </Text>
                  </View>
                  <View
                    style={{
                      transform: [
                        { rotate: detail === invite.id ? "90deg" : "0deg" },
                      ],
                    }}
                  >
                    <StudioIcon name="chevron" size={15} color={c.muted} />
                  </View>
                </Pressable>
                {detail === invite.id && (
                  <View style={{ gap: 6, paddingVertical: 6 }}>
                    <Text style={{ color: c.muted }}>
                      {t("Scade il ")}
                      {new Date(invite.expires_at).toLocaleDateString(locale)}
                    </Text>
                    {!expired && (
                      <>
                        <Text style={{ color: c.muted }}>
                          {t(
                            invite.delivery_status === "needs_configuration"
                              ? "Email non configurata. L’invito è disponibile nella Home del destinatario."
                              : invitationDeliveryLabel(invite.delivery_status),
                          )}
                        </Text>
                        <Action
                          disabled={busy}
                          variant="quiet"
                          label={t("Revoca invito")}
                          onPress={() =>
                            confirm(
                              t("Revocare l’invito a {0}?", recipient),
                              t("Il link non sarà più valido."),
                              {
                                type: "invitation.revoke",
                                invitationId: invite.id,
                              },
                            )
                          }
                        />
                      </>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
      {access.error && (
        <View>
          <Text accessibilityRole="alert" style={{ color: c.muted }}>
            {access.error}
          </Text>
          <Action label={t("Riprova")} onPress={access.refresh} />
        </View>
      )}
      <ToolRow
        label={t("La mia partecipazione")}
        expanded={detail === "self"}
        onPress={() => toggle("self")}
      />
      {detail === "self" && (
        <View style={{ gap: 4 }}>
          {own.length > 0 && (
            <Action
              label={t("Rinuncia alla gestione degli accessi")}
              variant="quiet"
              disabled={busy}
              onPress={() =>
                confirm(
                  t("Rinuncia alla gestione"),
                  t(
                    "Resterai nello spazio; la gestione potrebbe diventare indisponibile. Nessun successore verrà nominato.",
                  ),
                  { type: "access.relinquish", confirmed: true },
                )
              }
            />
          )}
          <Action
            label={t("Lascia lo spazio")}
            variant="outline"
            disabled={busy}
            onPress={() =>
              confirm(
                t("Lascia lo spazio"),
                t(
                  "Perderai accesso e partecipazione alla gestione. Storia e impegni resteranno nello spazio.",
                ),
                { type: "member.leave", confirmed: true },
              )
            }
          />
        </View>
      )}
    </View>
  );
}
