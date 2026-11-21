import { connectionName } from "../../src/shared/connection-name";
import { useUiLanguage } from "./i18n";
import React, { useEffect, useState } from "react";
import { Alert, Image, ScrollView, Text, View } from "react-native";
import * as Picker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ParticipantProfile } from "../../src/contracts/participant-profile";
import type { PhotoDirectory } from "../../src/contracts/identity-photos";
import type { AssistantSettings } from "../../src/contracts/assistant-settings";
import type { HomeProps } from "./AppHome";
import { post, problem, type NativeRequest } from "./api";
import { Action, Field, usePalette } from "./ui";
import { useResource } from "./useResource";
import { Panel } from "./workspace/SharedFiles";
import { shareBytes } from "./sharedFile";
import { IdentityMethods } from "./account/IdentityMethods";
import { useAppearance } from "./appearance";
import { LanguageChoice } from "./LanguageChoice";
function Photo({ request, path }: { request: NativeRequest; path: string }) {
  const { t: uiText } = useUiLanguage();
  const [uri, setUri] = useState("");
  useEffect(() => {
    const a = new AbortController();
    request
      .bytes(path, { signal: a.signal })
      .then((b) => {
        if (!a.signal.aborted)
          setUri(
            "data:image/jpeg;base64," +
              btoa(Array.from(b, (n) => String.fromCharCode(n)).join("")),
          );
      })
      .catch(() => {});
    return () => a.abort();
  }, [request, path]);
  return uri ? (
    <Image
      accessibilityLabel={uiText("La tua foto del profilo")}
      source={{ uri }}
      style={{ width: 84, height: 84, borderRadius: 42 }}
    />
  ) : null;
}
export function AccountSettings({
  request,
  origin,
  user,
  onBack,
  onLogout,
}: HomeProps & { onBack: () => void }) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    pref = useAppearance();
  const profile = useResource<ParticipantProfile>(request, "/api/v1/profile"),
    photos = useResource<PhotoDirectory>(request, "/api/v1/identity-photos");
  const [screen, setScreen] = useState<"account" | "assistant">("account");
  const [phone, setPhone] = useState<string | null>(null),
    [issue, setIssue] = useState(""),
    [busy, setBusy] = useState(false);
  async function update(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setIssue("");
    try {
      await work();
    } catch (e) {
      setIssue(problem(e, uiText));
    } finally {
      setBusy(false);
    }
  }
  async function changePhoto(remove = false) {
    if (!photos.value) return;
    let image: string | null = null;
    if (!remove) {
      const result = await Picker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled) return;
      const chosen = result.assets[0];
      const side = Math.min(chosen.width, chosen.height);
      if (!side) throw new Error("Immagine non leggibile");
      const transform = ImageManipulator.manipulate(chosen.uri);
      transform
        .crop({
          originX: Math.floor((chosen.width - side) / 2),
          originY: Math.floor((chosen.height - side) / 2),
          width: side,
          height: side,
        })
        .resize({ width: 256, height: 256 });
      const rendered = await transform.renderAsync();
      try {
        const jpeg = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress: 0.83,
          base64: true,
        });
        if (!jpeg.base64) throw new Error("Foto non disponibile");
        image = jpeg.base64;
      } finally {
        rendered.release();
        transform.release();
      }
    }
    await request(
      "/api/v1/identity-photos",
      post({
        expectedActorId: user.id,
        expectedVersion: photos.value.own.version,
        image,
      }),
    );
    photos.refresh();
  }
  if (screen === "assistant")
    return (
      <AssistantEditor
        request={request}
        actorId={user.id}
        onBack={() => setScreen("account")}
      />
    );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        padding: 20,
        gap: 12,
        maxWidth: 720,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <Action
        variant="quiet"
        label={uiText("Torna alla Home")}
        onPress={onBack}
      />
      <Text style={{ color: c.muted, fontWeight: "600" }}>
        {uiText("Il mio profilo")}
      </Text>
      <Text
        accessibilityRole="header"
        style={{ color: c.text, fontSize: 26, fontWeight: "700" }}
      >
        {user.name}
      </Text>
      <Text selectable style={{ color: c.muted }}>
        {user.email}
      </Text>
      {photos.value?.own.present && (
        <Photo
          key={photos.value.own.version}
          request={request}
          path={
            "/api/v1/identity-photos?image=1&person=" +
            encodeURIComponent(user.id)
          }
        />
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Action
          variant="outline"
          icon="image"
          label={
            photos.value?.own.present
              ? uiText("Cambia foto")
              : uiText("Aggiungi foto")
          }
          disabled={busy || !photos.value}
          onPress={() => void update(() => changePhoto())}
        />
        {photos.value?.own.present && (
          <Action
            label={uiText("Rimuovi foto")}
            disabled={busy}
            onPress={() =>
              Alert.alert(uiText("Rimuovere la foto del profilo?"), undefined, [
                { text: uiText("Annulla"), style: "cancel" },
                {
                  text: uiText("Rimuovi"),
                  style: "destructive",
                  onPress: () => void update(() => changePhoto(true)),
                },
              ])
            }
          />
        )}
      </View>
      {profile.value && (
        <>
          <Field
            value={phone ?? profile.value.phone ?? ""}
            label={uiText("Telefono (facoltativo)")}
            keyboardType="phone-pad"
            maxLength={32}
            onChangeText={setPhone}
          />
          <Action
            label={uiText("Salva telefono")}
            disabled={busy || phone === null}
            onPress={() =>
              void update(async () => {
                await request(
                  "/api/v1/profile",
                  post({
                    expectedActorId: user.id,
                    expectedVersion: profile.value!.version,
                    phone: phone?.trim() || null,
                  }),
                );
                setPhone(null);
                profile.refresh();
              })
            }
          />
        </>
      )}
      <LanguageChoice />
      <Text style={{ fontWeight: "600", color: c.text }}>
        {uiText("Aspetto")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(["system", "light", "dark"] as const).map((mode, i) => (
          <Action
            key={mode}
            label={uiText(["Sistema", "Chiaro", "Scuro"][i])}
            variant={pref.settings.mode === mode ? "selected" : "outline"}
            onPress={() => pref.save({ ...pref.settings, mode })}
          />
        ))}
      </View>
      <Text style={{ fontWeight: "600", color: c.text }}>
        {uiText("Colore di accento")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(["neutral", "ocean", "forest", "plum"] as const).map((accent, i) => (
          <Action
            key={accent}
            label={uiText(["Grafite", "Oceano", "Foresta", "Prugna"][i])}
            variant={pref.settings.accent === accent ? "selected" : "outline"}
            onPress={() => pref.save({ ...pref.settings, accent })}
          />
        ))}
      </View>
      <IdentityMethods origin={origin} user={user} request={request} />
      <Action
        icon="settings"
        variant="quiet"
        label={uiText("Configura Emme")}
        onPress={() => setScreen("assistant")}
      />
      <Action
        label={uiText("Esci dall’account")}
        onPress={() =>
          Alert.alert(uiText("Uscire da RIMIAM?"), undefined, [
            { text: uiText("Annulla"), style: "cancel" },
            { text: uiText("Esci"), onPress: onLogout },
          ])
        }
      />
      {[issue, profile.error, photos.error].filter(Boolean).map((m, i) => (
        <Text key={i} accessibilityRole="alert" style={{ color: c.text }}>
          {m}
        </Text>
      ))}
    </ScrollView>
  );
}
export function AssistantEditor({
  request,
  actorId,
  onBack,
  initialWorkspaceId,
  initialWorkspaceName,
  backLabel = "Il mio profilo",
}: {
  request: NativeRequest;
  actorId: string;
  onBack: () => void;
  initialWorkspaceId?: string;
  initialWorkspaceName?: string;
  backLabel?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const [scope, setScope] = useState(initialWorkspaceId ?? ""),
    c = usePalette();
  const base = "/api/v1/assistant-settings";
  const personal = useResource<AssistantSettings>(request, base);
  const workspace = useResource<AssistantSettings>(
    request,
    base + "?workspaceId=" + encodeURIComponent(scope),
    0,
    !!scope,
  );
  const settings = scope ? workspace : personal;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 18, gap: 12 }}
    >
      <Action label={backLabel} variant="quiet" onPress={onBack} />
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 25 }}>
        {uiText("Configura Emme")}
      </Text>
      {settings.value ? (
        <AssistantFields
          key={scope + ":" + settings.value.revision}
          saved={settings.value}
          scopePicker={(dirty, busy) => (
            <AssistantScopePicker
              current={scope}
              initial={initialWorkspaceId}
              initialName={initialWorkspaceName}
              spaces={personal.value?.managedSpaces ?? []}
              dirty={dirty}
              busy={busy}
              onChange={setScope}
            />
          )}
          request={request}
          actorId={actorId}
          scope={scope}
          refresh={settings.refresh}
        />
      ) : (
        <Text style={{ color: c.text }}>
          {settings.error || uiText("Caricamento istruzioni…")}
        </Text>
      )}
      {settings.error && (
        <Action label={uiText("Ricarica")} onPress={settings.refresh} />
      )}
    </ScrollView>
  );
}
function AssistantScopePicker({
  current,
  initial,
  initialName,
  spaces,
  dirty,
  busy,
  onChange,
}: {
  current: string;
  initial?: string;
  initialName?: string;
  spaces: AssistantSettings["managedSpaces"];
  dirty: boolean;
  busy: boolean;
  onChange: (id: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [pending, setPending] = useState<string | null>(null);
  const options = [
    { id: "", name: uiText("Tu ed Emme · Chat personale") },
    ...spaces.map((s) => ({ id: s.workspaceId, name: s.workspaceName })),
  ];
  if (initial && !options.some((o) => o.id === initial))
    options.push({
      id: initial,
      name: initialName || uiText("Spazio corrente"),
    });
  const close = () => {
    setOpen(false);
    setQuery("");
    setPending(null);
  };
  const finish = (id: string) => {
    close();
    onChange(id);
  };
  const choose = (id: string) => {
    if (id === current) {
      close();
      return;
    }
    if (dirty) setPending(id);
    else finish(id);
  };
  const matches = options.filter((option) =>
    option.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const scopeName =
    options.find((o) => o.id === current)?.name ?? uiText("Spazio corrente");
  return (
    <View style={{ gap: 6, alignItems: "flex-start" }}>
      <Text style={{ fontWeight: "600", color: c.text }}>
        {uiText("Conversazione da configurare")}
      </Text>
      <Action
        icon="chat"
        variant="outline"
        label={scopeName}
        disabled={busy || options.length === 1}
        onPress={() => setOpen(true)}
      />
      {open && (
        <Panel title={uiText("Conversazione da configurare")} onClose={close}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 12, gap: 5 }}
          >
            {pending === null ? (
              <>
                {options.length > 6 && (
                  <Field
                    label={uiText("Cerca una conversazione")}
                    value={query}
                    onChangeText={setQuery}
                    autoCorrect={false}
                    disableFullscreenUI
                  />
                )}
                {matches.map((o) => (
                  <Action
                    key={o.id}
                    label={o.name}
                    variant={o.id === current ? "selected" : "quiet"}
                    icon={o.id === current ? "check" : undefined}
                    onPress={() => choose(o.id)}
                  />
                ))}
                {matches.length === 0 && (
                  <Text style={{ color: c.muted }}>
                    {uiText("Nessuna conversazione trovata.")}
                  </Text>
                )}
              </>
            ) : (
              <>
                <Text style={{ color: c.text }}>
                  {uiText(
                    "Cambiare conversazione e uscire senza salvare le modifiche?",
                  )}
                </Text>
                <Action
                  label={uiText("Mantieni le modifiche")}
                  onPress={close}
                />
                <Action
                  label={uiText("Cambia senza salvare")}
                  onPress={() => finish(pending)}
                />
              </>
            )}
          </ScrollView>
        </Panel>
      )}
    </View>
  );
}
function AssistantFields({
  saved,
  scopePicker,
  request,
  actorId,
  scope,
  refresh,
}: {
  saved: AssistantSettings;
  scopePicker: (modified: boolean, busy: boolean) => React.ReactNode;
  request: NativeRequest;
  actorId: string;
  scope: string;
  refresh: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    [name, setName] = useState(saved.displayName),
    [instructions, setInstructions] = useState(saved.instructions),
    [connection, setConnection] = useState(saved.connectionId);
  const [details, setDetails] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = saved.connections.find((item) => item.id === connection);
  async function save() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(
        "/api/v1/assistant-settings",
        post({
          expectedActorId: actorId,
          workspaceId: scope || undefined,
          expectedRevision: saved.revision,
          connectionRevision: selected.revision,
          displayName: name.trim(),
          instructions,
          connectionId: connection,
        }),
      );
      refresh();
    } catch (e) {
      setError(problem(e, uiText));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {scopePicker(
        name !== saved.displayName ||
          instructions !== saved.instructions ||
          connection !== saved.connectionId,
        busy,
      )}
      <Text style={{ color: c.text, fontWeight: "600" }}>
        {uiText("Modello o agente")}
      </Text>
      {saved.connections.map((i) => (
        <Action
          disabled={
            !saved.canManage || busy || (!i.configured && i.id !== "default")
          }
          key={i.id}
          primary={connection === i.id}
          label={connectionName(i, uiText)}
          onPress={() => setConnection(i.id)}
        />
      ))}
      {selected && (
        <Text style={{ color: c.muted }}>{selected.destination}</Text>
      )}
      <Field
        label={uiText("Nome dell’assistente")}
        value={name}
        onChangeText={setName}
        editable={saved.canManage}
        maxLength={48}
      />
      <Field
        label={
          scope
            ? uiText("Istruzioni aggiuntive di questo spazio")
            : uiText("Istruzioni aggiuntive personali")
        }
        multiline
        value={instructions}
        editable={saved.canManage}
        maxLength={5000}
        onChangeText={setInstructions}
      />
      <Action
        label={
          details
            ? uiText("Chiudi istruzioni predefinite")
            : uiText("Leggi le istruzioni predefinite")
        }
        onPress={() => setDetails(!details)}
      />
      {details && (
        <Text selectable style={{ color: c.text }}>
          {saved.baseInstructions + "\n\n" + saved.defaultInstructions}
        </Text>
      )}
      <Action
        label={uiText("Esporta istruzioni salvate (.md)")}
        onPress={() =>
          void shareBytes(
            new TextEncoder().encode(saved.effectiveInstructions),
            "assistant-instructions.md",
            "text/markdown",
          ).catch((e) => setError(problem(e, uiText)))
        }
      />
      {saved.canManage && (
        <Action
          primary
          label={uiText("Salva impostazioni")}
          disabled={busy || !selected || !name.trim()}
          onPress={() =>
            connection !== saved.connectionId || saved.needsReconfirmation
              ? Alert.alert(
                  uiText("Conferma la connessione"),
                  selected?.destination,
                  [
                    { text: uiText("Annulla"), style: "cancel" },
                    { text: uiText("Conferma"), onPress: () => void save() },
                  ],
                )
              : void save()
          }
        />
      )}
      {error && (
        <>
          <Text accessibilityRole="alert" style={{ color: c.text }}>
            {error}
          </Text>
          <Action
            label={uiText("Ricarica versione salvata")}
            onPress={refresh}
          />
        </>
      )}
    </>
  );
}
