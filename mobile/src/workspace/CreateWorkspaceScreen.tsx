import { connectionName } from "../../../src/shared/connection-name";
import { useUiLanguage } from "../i18n";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { z } from "zod";
import type { AssistantSettings } from "../../../src/contracts/assistant-settings";
import { MAX_WORKSPACE_INVITE_RECIPIENTS } from "../../../src/contracts/workspace-invitations";
import {
  invitationSelection,
  recipientKey,
  type SelectedRecipient,
} from "../../../src/shared/invitation-selection";
import { ContactResults } from "./ContactPicker";
import { type NativeRequest, problem } from "../api";
import { HomeControl, ShellHeading } from "../AppShell";
import { StudioIcon } from "../StudioIcon";
import { Action, Field, usePalette } from "../ui";
import { type Attachment } from "./commands";
import { useCommands } from "./useCommands";
import { PendingStrip } from "./PendingStrip";
import { Attachments } from "./Attachments";

const historyDisclosure =
  "Chi accetta l’invito potrà vedere l’intera cronologia condivisa dello spazio.";

export function CreateWorkspaceScreen({
  actorId,
  origin,
  request,
  onBack,
  onCreated,
  initialContact,
  onOpenNavigation,
}: {
  actorId: string;
  origin: string;
  request: NativeRequest;
  onBack: () => void;
  onCreated: (workspace: { id: string; name: string }) => void;
  onOpenNavigation?: () => void;
  initialContact?: { id: string; name: string };
}) {
  const { t: uiText } = useUiLanguage();
  const scope = useMemo(() => ({ actorId, origin }), [actorId, origin]);
  const p = usePalette();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [history, setHistory] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [connection, setConnection] = useState<string | null>(null);
  const [picked, setPicked] = useState<SelectedRecipient[]>(() =>
    initialContact
      ? [
          {
            label: initialContact.name,
            target: { contactId: initialContact.id },
          },
        ]
      : [],
  );
  const [showContacts, setShowContacts] = useState(false);
  const [issue, setIssue] = useState("");
  const [load, setLoad] = useState(0);
  const commands = useCommands(request, scope, (pending) => {
    if (pending.intent.kind === "create") {
      onCreated({ id: pending.id, name: pending.intent.creation.name });
      if (pending.intent.creation.invitations?.recipients.length) {
        Alert.alert(
          uiText("Spazio e inviti creati"),
          uiText(
            "Chi hai invitato può accettare dalla Home con il proprio account verificato. In Strumenti → Persone puoi controllare gli inviti e lo stato dell’email.",
          ),
        );
      }
    }
  });
  useEffect(() => {
    const a = new AbortController();
    request<AssistantSettings>("/api/v1/assistant-settings", {
      signal: a.signal,
    })
      .then((s) => {
        if (!a.signal.aborted) {
          setSettings(s);
          setIssue("");
          setConnection((value) => value ?? "default");
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) setIssue(problem(e));
      });
    return () => a.abort();
  }, [request, load]);
  const selection = invitationSelection(picked, email);
  const recipients = selection.map((entry) => entry.target);
  const emailValid = z.email().safeParse(email.trim().toLowerCase()).success;
  const hasLimit = picked.length >= MAX_WORKSPACE_INVITE_RECIPIENTS;
  const pickedContacts = new Set(
    picked.flatMap(({ target }) =>
      "contactId" in target ? [target.contactId] : [],
    ),
  );
  const selected = settings?.connections.find((c) => c.id === connection);
  const usable = selected && (selected.configured || selected.id === "default");
  function create() {
    if (!name.trim() || !usable || (recipients.length && !history)) return;
    if (email.trim() && !emailValid) {
      setIssue(
        uiText(
          "Scegli un contatto dai risultati o completa l’indirizzo email.",
        ),
      );
      return;
    }
    if (
      email.trim() &&
      hasLimit &&
      !picked.some(
        ({ target }) =>
          "email" in target && target.email === email.trim().toLowerCase(),
      )
    ) {
      setIssue(
        uiText(
          "Puoi invitare fino a {0} persone alla creazione. Rimuovi un indirizzo per continuare.",
          String(MAX_WORKSPACE_INVITE_RECIPIENTS),
        ),
      );
      return;
    }
    setIssue("");
    void commands.send({
      kind: "create",
      label: "Crea " + name.trim(),
      files,
      creation: {
        name: name.trim(),
        description: description.trim() || undefined,
        assistantConnectionId: selected.id,
        assistantConnectionRevision: selected.revision,
        ...(recipients.length
          ? { invitations: { recipients, fullHistoryDisclosed: true as const } }
          : {}),
      },
    });
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: 28,
        maxWidth: 720,
        width: "100%",
        alignSelf: "center",
        gap: 9,
        backgroundColor: p.bg,
        flexGrow: 1,
      }}
    >
      <ShellHeading
        title={uiText("Nuovo spazio")}
        menu={onOpenNavigation}
        action={
          <HomeControl
            icon="close"
            label={uiText("Annulla")}
            onPress={onBack}
          />
        }
      />
      <Field
        label={uiText("Nome dello spazio")}
        value={name}
        onChangeText={setName}
        maxLength={120}
        placeholder={uiText("Es. Lancio RIMIAM")}
      />
      <Field
        label={uiText("Invita persone (facoltativo)")}
        placeholder={uiText("Nome del contatto o indirizzo email")}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setShowContacts(!!v.trim() && !v.includes("@"));
          setHistory(false);
        }}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={Keyboard.dismiss}
        editable={!hasLimit || !!email}
      />
      {emailValid && (
        <Action
          label={uiText("Aggiungi {0}", String(email.trim()))}
          icon="plus"
          variant="outline"
          disabled={!emailValid || hasLimit}
          onPress={() => {
            setPicked(selection);
            setEmail("");
            setShowContacts(false);
          }}
        />
      )}
      <HomeControl
        icon="people"
        label={
          showContacts
            ? uiText("Nascondi contatti")
            : uiText("Scegli dai tuoi contatti")
        }
        disabled={selection.length >= MAX_WORKSPACE_INVITE_RECIPIENTS}
        onPress={() => setShowContacts(!showContacts)}
      />
      {showContacts && (
        <ContactResults
          query={email.includes("@") ? "" : email}
          request={request}
          excluded={pickedContacts}
          onSelect={(person) => {
            setPicked((current) =>
              current.length >= MAX_WORKSPACE_INVITE_RECIPIENTS ||
              current.some(
                ({ target }) =>
                  "contactId" in target && target.contactId === person.id,
              )
                ? current
                : [
                    ...current,
                    { label: person.name, target: { contactId: person.id } },
                  ],
            );
            if (!emailValid) setEmail("");
            setShowContacts(false);
            setHistory(false);
          }}
        />
      )}
      {!!picked.length && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {picked.map((person) => (
            <Pressable
              key={recipientKey(person)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Rimuovi {0}", String(person.label))}
              onPress={() => {
                setPicked((current) =>
                  current.filter(
                    (entry) => recipientKey(entry) !== recipientKey(person),
                  ),
                );
                setHistory(false);
              }}
              style={{
                minHeight: 44,
                maxWidth: "100%",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 9,
                borderRadius: 8,
                backgroundColor: p.panel,
              }}
            >
              <Text style={{ flexShrink: 1, color: p.text }}>
                {person.label}
              </Text>
              <StudioIcon name="close" color={p.muted} size={13} />
            </Pressable>
          ))}
        </View>
      )}
      {recipients.length > 0 && (
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={uiText("Condividi la cronologia")}
          accessibilityHint={historyDisclosure}
          accessibilityState={{ checked: history }}
          onPress={() => setHistory((current) => !current)}
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Switch value={history} />
          </View>
          <Text style={{ flex: 1, color: p.text }}>{historyDisclosure}</Text>
        </Pressable>
      )}
      <Field
        label={uiText("Da dove partite? (facoltativo)")}
        value={description}
        onChangeText={setDescription}
        maxLength={2000}
        multiline
        style={{ minHeight: 78 }}
      />
      <Text style={{ color: p.muted, fontSize: 14 }}>
        {uiText("L’introduzione apparirà a tuo nome nella conversazione.")}
      </Text>
      <HomeControl
        icon="attach"
        label={
          showFiles ? uiText("Chiudi allegati") : uiText("Aggiungi allegati")
        }
        onPress={() => setShowFiles(!showFiles)}
      />
      {showFiles && <Attachments files={files} onChange={setFiles} />}
      <Text style={{ fontWeight: "600", color: p.text }}>
        {uiText("Modello o agente dello spazio")}
      </Text>
      {(settings?.connections ?? [])
        .filter((c) => c.configured || c.id === "default")
        .map((c) => (
          <Action
            key={c.id}
            label={connectionName(c, uiText)}
            variant={c.id === connection ? "selected" : "outline"}
            icon={c.id === connection ? "check" : undefined}
            onPress={() => setConnection(c.id)}
          />
        ))}
      {selected && (
        <Text style={{ color: p.muted, fontSize: 14 }}>
          {selected.configured
            ? uiText(
                "Le richieste e il contesto necessario saranno inviati a {0}.",
                String(selected.destination),
              )
            : uiText("Nessuna connessione attiva. Puoi collegarla in seguito.")}
        </Text>
      )}
      {!settings && (
        <Action
          label={uiText("Ricarica connessioni")}
          onPress={() => setLoad((n) => n + 1)}
        />
      )}
      {!!issue && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
          {issue}
        </Text>
      )}
      <PendingStrip commands={commands} />
      <Action
        label={
          recipients.length
            ? uiText("Crea spazio e invita")
            : uiText("Crea spazio")
        }
        primary
        disabled={
          !commands.ready ||
          !!commands.pending ||
          commands.working ||
          !name.trim() ||
          !usable ||
          (recipients.length > 0 && !history)
        }
        onPress={create}
      />
    </ScrollView>
  );
}
