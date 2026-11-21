import { useUiLanguage } from "../i18n";
import React from "react";
import { ScrollView, Text } from "react-native";
import type { ParticipantProfile } from "../../../src/contracts/participant-profile";
import type { PhotoDirectory } from "../../../src/contracts/identity-photos";
import type { NativeRequest } from "../api";
import { Action, usePalette } from "../ui";
import { useResource } from "../useResource";
import { HomeAvatar, memberPhotoPath } from "../AppShell";
import { Panel } from "./SharedFiles";
import { workspacePath } from "./commands";

export function MemberProfile({
  request,
  workspaceId,
  personId,
  name,
  onClose,
}: {
  request: NativeRequest;
  workspaceId: string;
  personId: string;
  name: string;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    profile = useResource<ParticipantProfile>(
      request,
      workspacePath(workspaceId) + "/profiles/" + encodeURIComponent(personId),
    );
  const directory =
    "/api/v1/identity-photos?workspace=" + encodeURIComponent(workspaceId);
  const photos = useResource<PhotoDirectory>(request, directory);
  return (
    <Panel title={name} onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: 9 }}>
        {profile.error && (
          <>
            <Text style={{ color: c.text }}>{profile.error}</Text>
            <Action label={uiText("Riprova")} onPress={profile.refresh} />
          </>
        )}
        {!profile.value && !profile.error && (
          <Text style={{ color: c.muted }}>{uiText("Apertura profilo…")}</Text>
        )}
        {profile.value && (
          <>
            <HomeAvatar
              request={request}
              name={name}
              size={80}
              path={memberPhotoPath(photos.value, workspaceId, personId)}
            />
            <Text style={{ color: c.muted }}>{uiText("Email")}</Text>
            <Text selectable style={{ color: c.text, fontSize: 18 }}>
              {profile.value.email}
            </Text>
            {profile.value.phone && (
              <>
                <Text style={{ color: c.muted }}>{uiText("Telefono")}</Text>
                <Text selectable style={{ color: c.text, fontSize: 18 }}>
                  {profile.value.phone}
                </Text>
              </>
            )}
          </>
        )}
      </ScrollView>
    </Panel>
  );
}
