import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Alert, ScrollView, Share, Switch, Text, View } from "react-native";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { ConversationDirectoryEntry } from "../../../src/contracts/conversation-reading";
import type { NativeRequest } from "../api";
import { Action, Field, usePalette } from "../ui";
import { useResource } from "../useResource";
import type { Commands } from "./useCommands";
import { ContactPicker, type ContactChoice } from "./ContactPicker";
import { Panel } from "./SharedFiles";

export function MemberInvite({
  request,
  commands,
  snapshot,
}: {
  request: NativeRequest;
  commands: Commands;
  snapshot: Snapshot;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const [email, setEmail] = useState(""),
    [contact, setContact] = useState<ContactChoice | null>(null),
    [pick, setPick] = useState(false),
    [history, setHistory] = useState(false),
    [sent, setSent] = useState(""),
    [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const issued = snapshot.invitations.find((i) => i.id === link?.id);
  const locked = !commands.ready || commands.working || !!commands.pending;
  const active = new Set(
    snapshot.members.filter((m) => m.active).map((m) => m.user_id),
  );
  const eligible = contact
    ? !active.has(contact.id)
    : /^\S+@\S+\.\S+$/.test(email.trim());
  async function invite() {
    if (locked || !history || !eligible) return;
    const target = contact
      ? { contactId: contact.id }
      : { email: email.trim().toLowerCase() };
    setLink(null);
    if (
      await commands.send(
        {
          kind: "command",
          label: "Invito allo spazio",
          command: {
            type: "invitation.create",
            ...target,
            sendEmail: true,
            fullHistoryDisclosed: true,
          },
        },
        (result) => {
          if (
            typeof result.invitationId === "string" &&
            typeof result.invitationUrl === "string"
          )
            setLink({ id: result.invitationId, url: result.invitationUrl });
        },
      )
    ) {
      setSent("Invito preparato per " + (contact?.name ?? email.trim()) + ".");
      setEmail("");
      setContact(null);
      setHistory(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {contact ? (
        <Action
          label={uiText("{0} · Cambia destinatario", String(contact.name))}
          disabled={locked}
          onPress={() => {
            setContact(null);
            setHistory(false);
            setSent("");
            setLink(null);
          }}
        />
      ) : (
        <>
          <Field
            label={uiText("Invita via email")}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setHistory(false);
              setSent("");
              setLink(null);
            }}
            editable={!locked}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Action
            label={uiText("Scegli dai tuoi contatti")}
            disabled={locked}
            onPress={() => setPick(true)}
          />
        </>
      )}
      {pick && (
        <ContactPicker
          request={request}
          excluded={active}
          onClose={() => setPick(false)}
          onSelect={(p) => {
            setContact(p);
            setEmail("");
            setPick(false);
            setHistory(false);
            setSent("");
            setLink(null);
          }}
        />
      )}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Switch
          accessibilityLabel={uiText("Conferma condivisione cronologia")}
          disabled={locked}
          value={history}
          onValueChange={setHistory}
        />
        <Text style={{ flex: 1, color: c.text }}>
          {uiText("Chi accetta potrà leggere tutta la cronologia condivisa.")}
        </Text>
      </View>
      <Action
        label={uiText("Invia invito")}
        disabled={locked || !eligible || !history}
        primary
        onPress={() => void invite()}
      />
      {!!sent && (
        <Text accessibilityLiveRegion="polite" style={{ color: c.muted }}>
          {sent}
        </Text>
      )}
      {link &&
        issued &&
        !issued.revoked_at &&
        !issued.accepted_at &&
        Date.parse(issued.expires_at) > Date.now() && (
          <Action
            label={uiText("Condividi il link con il destinatario")}
            onPress={() => {
              void Share.share({ message: link.url }).catch(() =>
                setSent("Impossibile aprire la condivisione del link."),
              );
            }}
          />
        )}
    </View>
  );
}

export function LinkedSpaces({
  snapshot,
  request,
  canWrite,
  commands,
  open,
}: {
  snapshot: Snapshot;
  request: NativeRequest;
  canWrite: boolean;
  commands: Commands;
  open: (id: string, name: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const c = usePalette();
  const rooms = useResource<{ workspaces: ConversationDirectoryEntry[] }>(
    request,
    "/api/v1/workspaces",
    5000,
  );
  const [picker, setPicker] = useState(false),
    [filter, setFilter] = useState(""),
    [history, setHistory] = useState<string | null>(null);
  const links = snapshot.links;
  const visible =
    links?.filter(
      (l) => l.active && rooms.value?.workspaces.some((w) => w.id === l.id),
    ) ?? [];
  const options =
    rooms.value?.workspaces.filter(
      (s) =>
        s.id !== snapshot.workspace.id &&
        !links?.some((l) => l.active && l.id === s.id) &&
        s.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()),
    ) ?? [];
  const locked =
    !canWrite ||
    !commands.ready ||
    commands.working ||
    !!commands.pending ||
    !links;
  function change(target: { id: string; name: string }, active: boolean) {
    if (
      locked ||
      !links ||
      !rooms.value?.workspaces.some((w) => w.id === target.id)
    )
      return;
    const version = links.find((l) => l.id === target.id)?.version ?? 0;
    const verb = active ? "Collega" : "Scollega";
    Alert.alert(
      verb + " «" + target.name + "»?",
      active
        ? uiText(
            "Il collegamento sarà visibile a chi partecipa a entrambi gli spazi. Ogni spazio conserva i propri contenuti e permessi.",
          )
        : uiText(
            "Le persone continueranno ad accedere agli spazi a cui partecipano.",
          ),
      [
        { text: uiText("Annulla"), style: "cancel" },
        {
          text: verb,
          onPress: () => {
            setPicker(false);
            void commands.send({
              kind: "command",
              label: verb + " spazio",
              command: {
                type: "workspace.link",
                otherWorkspaceId: target.id,
                expectedVersion: version,
                linked: active,
              },
            });
          },
        },
      ],
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.muted }}>
        {uiText("Visibili a chi partecipa a entrambi gli spazi.")}
      </Text>
      {rooms.error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: c.text }}>
            {rooms.error}
          </Text>
          <Action label={uiText("Riprova")} onPress={rooms.refresh} />
        </>
      ) : !rooms.value ? (
        <Text style={{ color: c.muted }}>{uiText("Caricamento spazi…")}</Text>
      ) : (
        !visible.length && (
          <Text style={{ color: c.muted }}>
            {uiText("Nessun collegamento visibile.")}
          </Text>
        )
      )}
      {visible.map((l) => (
        <View key={l.id} style={{ gap: 6 }}>
          <Action
            label={uiText("Apri {0}", String(l.name))}
            onPress={() => open(l.id, l.name)}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Action
              label={
                history === l.id
                  ? uiText("Chiudi cronologia")
                  : uiText("Cronologia")
              }
              onPress={() => setHistory(history === l.id ? null : l.id)}
            />
            {canWrite && (
              <Action
                label={uiText("Scollega")}
                disabled={locked}
                onPress={() => change(l, false)}
              />
            )}
          </View>
          {history === l.id &&
            l.history.map((v) => (
              <Text key={v.version} style={{ color: c.muted }}>
                {new Date(v.created_at).toLocaleString(locale)} ·{" "}
                {v.active ? uiText("Collegato") : uiText("Scollegato")} ·{" "}
                {snapshot.members.find((m) => m.user_id === v.actor_id)?.name ??
                  v.actor_id}
              </Text>
            ))}
        </View>
      ))}
      {canWrite && (
        <Action
          label={uiText("Collega uno spazio")}
          disabled={locked || !rooms.value}
          onPress={() => {
            setFilter("");
            setPicker(true);
          }}
        />
      )}
      {picker && (
        <Panel
          title={uiText("Collega uno spazio")}
          onClose={() => setPicker(false)}
        >
          <Field
            label={uiText("Cerca uno spazio")}
            value={filter}
            onChangeText={setFilter}
          />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8 }}
          >
            {options.map((s) => (
              <Action
                key={s.id}
                label={s.name}
                onPress={() => change(s, true)}
                disabled={locked}
              />
            ))}
            {!options.length && (
              <Text style={{ color: c.muted }}>
                {uiText("Nessuno spazio disponibile.")}
              </Text>
            )}
          </ScrollView>
        </Panel>
      )}
    </View>
  );
}
