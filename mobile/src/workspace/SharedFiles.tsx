import { useHiddenLibrary } from "./useHiddenLibrary";
import { useUiLanguage } from "../i18n";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  useWindowDimensions,
  KeyboardAvoidingView,
  StyleSheet,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ToolHeader, ToolRow, ChoiceStrip } from "./ToolLayout";
import { DateField } from "../DateField";
import { LibraryNote } from "./LibraryNote";
import { GeneratedDocument } from "./GeneratedDocument";
import { StudioIcon } from "../StudioIcon";
import {
  libraryDay,
  libraryEntryKey,
  type LibraryEntry,
  libraryView,
  libraryPeriods,
  libraryTabs,
  type LibraryTab,
} from "../../../src/shared/library-view";
import { Platform } from "react-native";
import { pageMessage, sharedFileType } from "../../../src/shared/file-library";
import { ProtectedImage } from "../ProtectedImage";
import { isSharedPhoto } from "../../../src/shared/photo-media-type";
import { AttachmentPreview } from "../AttachmentPreview";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type {
  ReferenceDetail,
  ConversationReference,
} from "../../../src/contracts/activity";
import type { NativeRequest } from "../api";
import { Action, Field, usePalette } from "../ui";
import { describe, type Commands } from "./useCommands";
import { workspacePath } from "./commands";

type Source = Snapshot["sources"][number];
export function Panel({
  title,
  onClose,
  children,
  visible = true,
  onDismiss,
}: {
  title: string;
  visible?: boolean;
  onDismiss?: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const { width, height } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const wide = width > 760;
  const [expanded, setExpanded] = useState(false);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismiss}
      supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          flex: 1,
          alignItems: wide ? "flex-end" : "stretch",
          backgroundColor: wide ? "#10151458" : p.bg,
          paddingTop: safe.top + (wide ? 12 : 0),
          paddingBottom: safe.bottom + (wide ? 12 : 0),
          paddingLeft: safe.left,
          paddingRight: safe.right + (wide ? 12 : 0),
        }}
      >
        {wide && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText("Chiudi pannello")}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={{
            flex: 1,
            ...(wide
              ? {
                  width: expanded
                    ? width - safe.left - safe.right - 24
                    : Math.min(width * 0.78, 580),
                }
              : {}),
            borderRadius: wide ? 14 : 0,
            overflow: "hidden",
            backgroundColor: p.bg,
          }}
        >
          <ToolHeader
            title={title}
            onClose={onClose}
            headerActions={
              wide ? (
                <Action
                  label={expanded ? uiText("Riduci") : uiText("Allarga")}
                  variant="quiet"
                  onPress={() => setExpanded(!expanded)}
                />
              ) : undefined
            }
          />
          <View
            style={{
              flex: 1,
              minHeight: 0,
              paddingHorizontal: height < 420 ? 12 : 16,
              paddingVertical: height < 420 ? 4 : 10,
            }}
          >
            {children}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function ReferencePanel({
  refValue,
  request,
  path,
  onClose,
  onMessage,
  snapshot,
}: {
  refValue: ConversationReference;
  request: NativeRequest;
  path: string;
  onClose: () => void;
  onMessage?: (id: string) => void;
  snapshot?: Snapshot;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const [record, setRecord] = useState<ReferenceDetail | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [ref, setRef] = useState(refValue);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setRecord(null);
    const q = new URLSearchParams({
      kind: ref.kind,
      id: ref.id,
      version: String(ref.version),
      ...(ref.eventId ? { eventId: ref.eventId } : {}),
    });
    request<ReferenceDetail>(path + "/reference?" + q, { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) setRecord(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(describe(e));
      });
    return () => c.abort();
  }, [ref, path, request, tick]);
  const message =
    snapshot?.messages.find((m) => m.id === ref.id)?.id ??
    snapshot?.sources.find((s) => s.id === ref.id)?.shared_message_id;
  return (
    <Panel title={record?.title ?? uiText("Riferimento")} onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        {!!error && (
          <>
            <Text style={{ color: p.text }}>{error}</Text>
            <Action
              label={uiText("Riprova")}
              onPress={() => setTick((n) => n + 1)}
            />
          </>
        )}
        {!record && !error && (
          <Text style={{ color: p.muted }}>{uiText("Caricamento…")}</Text>
        )}
        {record && (
          <>
            <Text style={{ color: p.muted }}>
              {record.qualification} ·{" "}
              {new Date(record.createdAt).toLocaleDateString(locale)}
            </Text>
            <Text
              selectable
              style={{ color: p.text, fontSize: 17, lineHeight: 24 }}
            >
              {record.content}
            </Text>
            {!!message && onMessage && (
              <Action
                label={uiText("Vai al messaggio")}
                onPress={() => onMessage(message)}
              />
            )}
            {record.sourceIds
              .filter((s) => s !== ref.id)
              .map((id, i) => (
                <Action
                  key={id}
                  label={uiText("Fonte {0}", String(i + 1))}
                  onPress={() => setRef({ kind: "source", id, version: 1 })}
                />
              ))}
          </>
        )}
      </ScrollView>
    </Panel>
  );
}
function FileVisibilityAction({
  file,
  commands,
  personal,
  onSaved,
}: {
  file: Source;
  commands: Commands;
  personal?: boolean;
  onSaved?: () => void;
}) {
  const { t } = useUiLanguage();
  if (
    !file.can_manage_visibility ||
    !file.document_version ||
    !file.visibility_version
  )
    return null;
  const label = t(
    file.withdrawn
      ? "Ripristina file"
      : personal
        ? "Rimuovi dai miei documenti"
        : "Rimuovi per tutti",
  );
  const note = personal
    ? file.withdrawn
      ? "Il file sarà di nuovo disponibile nei tuoi documenti."
      : "Il file verrà ritirato dai tuoi documenti. Potrai ripristinarlo da File ritirati."
    : file.withdrawn
      ? "Questa versione tornerà disponibile ai membri dello spazio."
      : "Nessuno nello spazio potrà aprire questa versione. Il messaggio e le citazioni resteranno nella cronologia. Puoi ripristinarla.";
  return (
    <Action
      label={label}
      variant="quiet"
      disabled={!commands.ready || commands.working || !!commands.pending}
      onPress={() =>
        Alert.alert(
          t("{0} «{1}»?", label, file.filename ?? file.title),
          t(note),
          [
            { text: t("Annulla"), style: "cancel" },
            {
              text: label,
              style: file.withdrawn ? "default" : "destructive",
              onPress: () => {
                void commands
                  .send({
                    kind: "command",
                    label,
                    command: {
                      type: file.withdrawn
                        ? "document.restore"
                        : "document.withdraw",
                      sourceId: file.id,
                      documentVersion: file.document_version!,
                      expectedVisibilityVersion: file.visibility_version!,
                    },
                  })
                  .then((ok) => {
                    if (ok) onSaved?.();
                  });
              },
            },
          ],
        )
      }
    />
  );
}
export function SharedFiles({
  snapshot,
  request,
  open,
  onAttach,
  onMessage,
  commands,
  onDocuments,
  onNewDocument,
  identity,
  onClose,
  headerActions,
  onBack,
}: {
  onMessage: (id: string) => void;
  commands: Commands;
  snapshot: Snapshot;
  request: NativeRequest;
  open: (s: Source) => void;
  onAttach?: () => void;
  onDocuments?: () => void;
  onNewDocument?: () => void;
  identity: { actorId: string; origin: string };
  onClose?: () => void;
  headerActions?: React.ReactNode;
  onBack?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const [tab, setTab] = useState<LibraryTab>("Recenti"),
    [term, setTerm] = useState(""),
    [period, setPeriod] = useState<keyof typeof libraryPeriods>("all"),
    [type, setType] = useState(""),
    [day, setDay] = useState(""),
    [until, setUntil] = useState("");
  const [filters, setFilters] = useState(false),
    [form, setForm] = useState<"note" | "link" | null>(null),
    [pageDraft, setPageDraft] = useState(""),
    [ack, setAck] = useState(""),
    [withdrawn, setWithdrawn] = useState(false),
    [showHidden, setShowHidden] = useState(false),
    [documentOptions, setDocumentOptions] = useState(false),
    [removing, setRemoving] = useState<string | null>(null);
  const [width, setWidth] = useState(320);
  const [generate, setGenerate] = useState(false);
  const personal = snapshot.workspace.personal;
  const preferences = useHiddenLibrary(
    identity.origin,
    identity.actorId,
    snapshot.workspace.id,
  );
  const hiddenView = showHidden && !!preferences.ids?.size;
  const page = pageMessage(pageDraft, personal);
  const { list, all, links, emptySharedLibrary, messagesById } = useMemo(
    () =>
      libraryView(snapshot, { tab, term, period, type, day, until, personal }),
    [snapshot, tab, term, period, type, day, until, personal],
  );
  const types = Array.from(
    new Set([
      ...all.map((f) => sharedFileType(f.media_type, f.filename ?? f.title)),
      "Collegamento",
    ]),
  ).sort();
  const columns =
    tab === "Media"
      ? Math.max(1, Math.min(6, Math.floor((width - 32) / 138)))
      : 1;
  const busy = !commands.ready || commands.working || !!commands.pending;
  const gone = snapshot.sources.filter(
    (f) => f.withdrawn && f.can_manage_visibility,
  );
  const loadingPreference = !preferences.ids && !preferences.failed;
  const visible = loadingPreference
    ? []
    : list.filter(
        (entry) =>
          (preferences.ids?.has(libraryEntryKey(entry)) ?? false) ===
          hiddenView,
      );
  async function changeHidden(key: string, hide: boolean) {
    if (!(await preferences.change(key, hide))) return;
    setRemoving(null);
    if (!hide && preferences.ids?.size === 1) setShowHidden(false);
    setAck(
      uiText(
        hide
          ? "Elemento nascosto su questo dispositivo."
          : "Elemento di nuovo visibile.",
      ),
    );
  }
  function removeAction(entry: LibraryEntry) {
    const key = libraryEntryKey(entry);
    return (
      <Action
        variant="quiet"
        label={uiText(hiddenView ? "Mostra di nuovo" : "Rimuovi")}
        disabled={hiddenView && !preferences.ids}
        onPress={() =>
          hiddenView
            ? void changeHidden(key, false)
            : setRemoving(removing === key ? null : key)
        }
      />
    );
  }
  function removeOptions(entry: LibraryEntry) {
    const key = libraryEntryKey(entry);
    if (hiddenView || removing !== key) return null;
    return (
      <View style={{ gap: 2, alignItems: "flex-start", paddingVertical: 4 }}>
        <Action
          variant="quiet"
          label={uiText("Nascondi su questo dispositivo")}
          disabled={!preferences.ids}
          onPress={() => void changeHidden(key, true)}
        />
        {entry.file && (
          <FileVisibilityAction
            file={entry.file}
            commands={commands}
            personal={personal}
            onSaved={() => setRemoving(null)}
          />
        )}
        <Action
          variant="quiet"
          label={uiText("Annulla")}
          onPress={() => setRemoving(null)}
        />
      </View>
    );
  }
  const header = (
    <View style={{ gap: 8, paddingBottom: 8 }}>
      <View style={{ gap: 5 }}>
        <Text style={{ color: p.muted }}>
          {uiText(
            personal
              ? "File, foto, link e note visibili solo a te."
              : "File, foto e link dalla chat dello spazio.",
          )}
        </Text>
        {onAttach && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            <Action
              label={uiText("Allega file")}
              primary
              icon="attach"
              onPress={onAttach}
              disabled={busy}
            />
            <Action
              label={uiText("Nuova nota")}
              variant="quiet"
              icon="plus"
              onPress={() => {
                setForm("note");
                setAck("");
              }}
              disabled={busy}
            />
            <Action
              label={uiText("Aggiungi link")}
              variant="quiet"
              icon="link"
              onPress={() => {
                setForm("link");
                setAck("");
              }}
              disabled={busy}
            />
            {personal && (
              <Action
                label={uiText("Crea documento")}
                variant="quiet"
                icon="files"
                onPress={() => setDocumentOptions(!documentOptions)}
              />
            )}
          </View>
        )}
        {onAttach && personal && documentOptions && (
          <View style={{ alignItems: "flex-start" }}>
            {onNewDocument && (
              <Action
                variant="quiet"
                label={uiText("Nuovo documento")}
                onPress={onNewDocument}
              />
            )}
            <Action
              variant="quiet"
              label={uiText("Chiedi un documento a Emme")}
              onPress={() => setGenerate(true)}
            />
          </View>
        )}
        {form === "link" && (
          <>
            <Field
              label={uiText("Indirizzo della pagina")}
              value={pageDraft}
              onChangeText={setPageDraft}
              autoCapitalize="none"
              keyboardType="url"
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Action
                primary
                label={
                  personal ? uiText("Salva link") : uiText("Condividi link")
                }
                disabled={!page || busy}
                onPress={() => {
                  if (page)
                    void commands
                      .send({
                        kind: "command",
                        label: "Aggiungi link",
                        command: {
                          type: "message.send",
                          content: page,
                        },
                      })
                      .then((ok) => {
                        if (ok) {
                          setPageDraft("");
                          setForm(null);
                          setAck(
                            uiText(
                              personal
                                ? "Pagina salvata."
                                : "Pagina condivisa.",
                            ),
                          );
                        }
                      });
                }}
              />
              <Action label={uiText("Annulla")} onPress={() => setForm(null)} />
            </View>
          </>
        )}
        {form === "note" && (
          <LibraryNote
            personal={personal}
            commands={commands}
            onClose={() => setForm(null)}
            onQueued={() => {
              setForm(null);
              setAck(uiText("Verifica l’invio in sospeso prima di riprovare."));
            }}
            onSaved={(name) => {
              setForm(null);
              setAck(
                uiText(
                  personal ? "Nota salvata · {0}" : "Nota condivisa · {0}",
                  name,
                ),
              );
            }}
          />
        )}
      </View>
      {preferences.failed && (
        <View style={{ alignItems: "flex-start" }}>
          <Text accessibilityRole="alert" style={{ color: p.danger }}>
            {uiText("Il dispositivo non ha salvato o caricato la preferenza.")}
          </Text>
          <Action
            variant="quiet"
            label={uiText("Riprova")}
            onPress={preferences.retry}
          />
        </View>
      )}
      {!!ack && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.muted }}>
          {ack}
        </Text>
      )}
      <ChoiceStrip
        label={uiText("Raccoglitore")}
        choices={libraryTabs}
        value={tab}
        onSelect={(t) => setTab(t as LibraryTab)}
      />
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
        <View style={{ flex: 1 }}>
          <Field
            label={uiText("Cerca")}
            value={term}
            onChangeText={setTerm}
            placeholder={uiText("Nome o parola chiave")}
          />
        </View>
        {
          <Action
            label={uiText(
              "Filtri{0}",
              String(
                period !== "all" || type
                  ? " · " + (Number(period !== "all") + Number(!!type))
                  : "",
              ),
            )}
            variant="quiet"
            onPress={() => setFilters(!filters)}
          />
        }
      </View>
      {filters && (
        <>
          <Text style={{ color: p.muted }}>
            {uiText("Data di condivisione")}
          </Text>
          <ChoiceStrip
            label={uiText("Data")}
            value={libraryPeriods[period]}
            choices={Object.values(libraryPeriods)}
            onSelect={(l) => {
              const k = (
                Object.keys(libraryPeriods) as (keyof typeof libraryPeriods)[]
              ).find((k) => libraryPeriods[k] === l);
              if (k) setPeriod(k);
            }}
          />
          {period === "range" && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <DateField
                label={uiText("Dal")}
                emptyDateLabel={day ? undefined : "Scegli data"}
                dateOnly
                value={day ? new Date(day + "T12:00:00") : new Date()}
                change={(d) => {
                  const value = libraryDay(d);
                  setDay(value);
                  if (until && until < value) setUntil(value);
                }}
              />
              <DateField
                label={uiText("Al")}
                emptyDateLabel={until ? undefined : "Scegli data"}
                dateOnly
                value={until ? new Date(until + "T12:00:00") : new Date()}
                change={(d) => {
                  const value = libraryDay(d);
                  setUntil(value);
                  if (day && day > value) setDay(value);
                }}
              />
            </View>
          )}
          <Text style={{ color: p.muted }}>{uiText("Tipo")}</Text>
          <ChoiceStrip
            label={uiText("Tipo")}
            choices={["Tutti", ...types]}
            value={type || "Tutti"}
            onSelect={(v) => setType(v === "Tutti" ? "" : v)}
          />
          {!!(period !== "all" || type || term) && (
            <Action
              label={uiText("Azzera filtri")}
              variant="quiet"
              onPress={() => {
                setType("");
                setTerm("");
                setPeriod("all");
                setDay("");
                setUntil("");
              }}
            />
          )}
        </>
      )}
    </View>
  );
  return (
    <View
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {onClose && (
        <ToolHeader
          title={personal ? uiText("Documenti personali") : uiText("Condivisi")}
          onClose={onClose}
          contextName={personal ? undefined : snapshot.workspace.name}
          onBack={onBack}
          headerActions={headerActions}
        />
      )}
      <FlatList
        data={visible}
        key={columns}
        numColumns={columns}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={libraryEntryKey}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={{ color: p.muted, paddingVertical: 14 }}>
            {loadingPreference
              ? uiText("Caricamento…")
              : hiddenView
                ? uiText("Nessun elemento nascosto per questi filtri.")
                : emptySharedLibrary
                  ? uiText("Nessun elemento condiviso")
                  : !all.length && !links.length
                    ? uiText("Nessun elemento da mostrare.")
                    : tab === "Preferiti"
                      ? uiText("Nessun preferito per questi filtri.")
                      : uiText("Nessun elemento per questi filtri.")}
          </Text>
        }
        ListFooterComponent={
          <View style={{ marginTop: 14 }}>
            {!!preferences.ids?.size && (
              <Action
                label={uiText(
                  hiddenView
                    ? "Torna agli elementi visibili"
                    : "Mostra elementi nascosti",
                )}
                variant="quiet"
                onPress={() => {
                  if (!hiddenView) {
                    setTab("Recenti");
                    setPeriod("all");
                    setTerm("");
                    setType("");
                    setDay("");
                    setUntil("");
                  }
                  setRemoving(null);
                  setAck("");
                  setShowHidden(!hiddenView);
                }}
              />
            )}
            {((onDocuments && (!personal || snapshot.artifacts.length > 0)) ||
              (!personal && onAttach)) && (
              <View
                style={{
                  paddingTop: 12,
                  gap: 4,
                  borderTopWidth: 1,
                  borderColor: p.line,
                }}
              >
                {onDocuments ? (
                  <ToolRow
                    label={uiText(
                      "Documenti di lavoro · {0}",
                      String(snapshot.artifacts.length),
                    )}
                    onPress={onDocuments}
                  />
                ) : (
                  <Text
                    accessibilityRole="header"
                    style={{ color: p.text, fontWeight: "700" }}
                  >
                    {uiText("I tuoi documenti")}
                  </Text>
                )}
                {!personal && onAttach && onNewDocument && (
                  <Action
                    variant="quiet"
                    label={uiText("Nuovo documento")}
                    onPress={onNewDocument}
                  />
                )}
                {!personal && onAttach && (
                  <Action
                    variant="quiet"
                    label={uiText("Chiedi un documento a Emme")}
                    onPress={() => setGenerate(true)}
                  />
                )}
              </View>
            )}
            {gone.length > 0 && (
              <ToolRow
                label={uiText("File ritirati")}
                expanded={withdrawn}
                onPress={() => setWithdrawn(!withdrawn)}
              />
            )}
            {withdrawn &&
              gone.map((f) => (
                <ToolRow
                  key={f.id}
                  label={f.filename ?? f.title}
                  onPress={() => open(f)}
                />
              ))}
          </View>
        }
        renderItem={({ item, index }) => {
          const file = item.file;
          const date = new Date(item.date).toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          if (!file) {
            const link = item.link!,
              msg = messagesById.get(link.id)!;
            return (
              <View
                style={{
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderColor: p.line,
                  gap: 4,
                }}
              >
                <View
                  style={{ flexDirection: "row", gap: 9, alignItems: "center" }}
                >
                  <StudioIcon name="link" color={p.muted} size={24} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {link.url ? (
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={link.url}
                        style={{ minHeight: 44, justifyContent: "center" }}
                        onPress={() =>
                          void Linking.openURL(link.url!).catch(() =>
                            setAck(
                              uiText("Impossibile aprire il collegamento."),
                            ),
                          )
                        }
                      >
                        <Text
                          style={{ color: p.text, fontWeight: "600" }}
                          numberOfLines={1}
                        >
                          {new URL(link.url).hostname}
                        </Text>
                        <Text
                          style={{ color: p.muted, fontSize: 13 }}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {link.url}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text
                        style={{ color: p.text, fontWeight: "600" }}
                        numberOfLines={1}
                      >
                        {link.title}
                      </Text>
                    )}
                    <Text
                      style={{ color: p.muted, fontSize: 13 }}
                      numberOfLines={2}
                    >
                      {uiText("Collegamento")} · {date} · {msg.author_name}
                    </Text>
                  </View>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <Action
                    variant="quiet"
                    label={uiText("Vai al messaggio")}
                    onPress={() => onMessage(link.id)}
                  />
                  {removeAction(item)}
                </View>
                {removeOptions(item)}
              </View>
            );
          }
          const title = file.filename ?? file.title,
            media = tab === "Media",
            author = messagesById.get(
              file.shared_message_id ?? "",
            )?.author_name;
          return (
            <View
              style={
                media
                  ? { width: (width - 32) / columns, padding: 4 }
                  : {
                      borderBottomWidth: 1,
                      borderColor: p.line,
                    }
              }
            >
              {media &&
                (index === 0 ||
                  libraryDay(visible[index - 1].date) !==
                    libraryDay(item.date)) && (
                  <Text style={{ color: p.muted, fontSize: 12 }}>{date}</Text>
                )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={uiText("Apri {0}", String(title))}
                onPress={() => open(file)}
                style={({ pressed }) => ({
                  paddingVertical: 8,
                  gap: 8,
                  alignItems: media ? "stretch" : "center",
                  flexDirection: media ? "column" : "row",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                {isSharedPhoto(file.media_type) ? (
                  <ProtectedImage
                    request={request}
                    path={
                      workspacePath(snapshot.workspace.id) +
                      "/source-file?id=" +
                      encodeURIComponent(file.id)
                    }
                    mediaType={file.media_type!}
                    label={title}
                    style={
                      media
                        ? { width: "100%", aspectRatio: 1.45, borderRadius: 8 }
                        : { width: 42, height: 42, borderRadius: 7 }
                    }
                  />
                ) : (
                  <StudioIcon name="files" color={p.muted} size={25} />
                )}
                <View style={{ flex: media ? undefined : 1, gap: 2 }}>
                  <Text
                    numberOfLines={2}
                    style={{ color: p.text, fontSize: 16, fontWeight: "600" }}
                  >
                    {title}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{ color: p.muted, fontSize: 13 }}
                  >
                    {uiText(sharedFileType(file.media_type, title))} · {date}
                    {author ? " · " + author : ""}
                  </Text>
                </View>
              </Pressable>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    file.favorite
                      ? uiText("Rimuovi dai miei preferiti")
                      : uiText("Aggiungi ai miei preferiti")
                  }
                  accessibilityState={{
                    selected: file.favorite,
                    disabled: busy,
                  }}
                  disabled={busy}
                  onPress={() =>
                    void commands.send({
                      kind: "command",
                      label: "Preferiti",
                      command: {
                        type: "library.favorite",
                        sourceId: file.id,
                        starred: !file.favorite,
                      },
                    })
                  }
                  style={{
                    alignSelf: media ? "flex-end" : "center",
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 21,
                      color: file.favorite ? p.accent : p.muted,
                    }}
                  >
                    {file.favorite ? "★" : "☆"}
                  </Text>
                </Pressable>
                {removeAction(item)}
              </View>
              {removeOptions(item)}
            </View>
          );
        }}
      />
      {generate && (
        <Panel
          title={uiText("Documento personale di Emme")}
          onClose={() => setGenerate(false)}
        >
          <GeneratedDocument
            key={snapshot.workspace.id}
            request={request}
            identity={identity}
            workspaceId={snapshot.workspace.id}
            destination={personal ? undefined : snapshot.workspace.name}
          />
        </Panel>
      )}
    </View>
  );
}
export function FilePanel({
  file,
  request,
  workspaceId,
  onClose,
  onMessage,
  commands,
  canWrite,
  extraAction,
  personal = false,
}: {
  file: Source;
  request: NativeRequest;
  workspaceId: string;
  onClose: () => void;
  onMessage: (id: string) => void;
  commands: Commands;
  extraAction?: React.ReactNode;
  personal?: boolean;
  canWrite: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const [error, setError] = useState("");
  return (
    <Panel title={file.filename ?? file.title} onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        {!file.withdrawn && extraAction}
        <Text style={{ color: p.muted }}>
          {new Date(file.created_at).toLocaleString(locale)}
        </Text>
        {file.filename && !file.withdrawn && (
          <AttachmentPreview
            request={request}
            path={
              workspacePath(workspaceId) +
              "/source-file?id=" +
              encodeURIComponent(file.id)
            }
          />
        )}
        {!file.withdrawn && !file.filename && file.content && (
          <Text selectable style={{ color: p.text }}>
            {file.content}
          </Text>
        )}
        {!!error && <Text style={{ color: p.text }}>{error}</Text>}
        {!file.withdrawn && file.url && /^https?:\/\//i.test(file.url) && (
          <Action
            label={uiText("Apri collegamento esterno")}
            onPress={() =>
              Alert.alert(uiText("Aprire il sito esterno?"), file.url ?? "", [
                { text: uiText("Annulla"), style: "cancel" },
                {
                  text: uiText("Apri"),
                  onPress: () => {
                    void Linking.openURL(file.url!).catch((e) =>
                      setError(describe(e)),
                    );
                  },
                },
              ])
            }
          />
        )}
        {!!file.shared_message_id && (
          <Action
            label={uiText("Vai al messaggio")}
            onPress={() => onMessage(file.shared_message_id!)}
          />
        )}
        <FileVisibilityAction
          file={file}
          commands={commands}
          personal={personal}
          onSaved={onClose}
        />
        {!file.withdrawn &&
          canWrite &&
          ["failed", "needs_input", "needs_configuration"].includes(
            file.processing_status ?? "",
          ) && (
            <Action
              label={
                file.processing_error === "MEDIA_DISCLOSURE_REQUIRED"
                  ? uiText("Consenti lettura con AI…")
                  : uiText("Riprova lettura")
              }
              disabled={
                !commands.ready || commands.working || !!commands.pending
              }
              onPress={() => {
                const media = /^(image|audio)\//.test(file.media_type ?? "");
                const run = () =>
                  void commands.send({
                    kind: "command",
                    label: "Rileggi fonte",
                    command: {
                      type: "document.retry",
                      sourceId: file.id,
                      ...(media ? { allowModelProcessing: true as const } : {}),
                    },
                  });
                if (media)
                  Alert.alert(
                    uiText("Consenti lettura con AI?"),
                    uiText(
                      "Questo file verrà inviato al servizio AI configurato per estrarne il contenuto.",
                    ),
                    [
                      { text: uiText("Annulla"), style: "cancel" },
                      { text: uiText("Consenti"), onPress: run },
                    ],
                  );
                else run();
              }}
            />
          )}
        {!file.withdrawn && (
          <Action
            label={
              file.favorite
                ? uiText("Togli dai preferiti")
                : uiText("Aggiungi ai preferiti")
            }
            disabled={commands.working || !!commands.pending || !commands.ready}
            onPress={() =>
              void commands.send({
                kind: "command",
                label: "Preferiti personali",
                command: {
                  type: "library.favorite",
                  sourceId: file.id,
                  starred: !file.favorite,
                },
              })
            }
          />
        )}
      </ScrollView>
    </Panel>
  );
}
