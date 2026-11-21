import { useUiLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { noteFilename } from "../../../src/shared/file-library";
import { Action, Field, usePalette } from "../ui";
import { captureAttachment } from "./commands";
import { describe, type Commands } from "./useCommands";

export function LibraryNote({
  commands,
  personal,
  onClose,
  onQueued,
  onSaved,
}: {
  commands: Commands;
  personal: boolean;
  onClose: () => void;
  onQueued: () => void;
  onSaved: (name: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const [body, setBody] = useState(""),
    [error, setError] = useState("");
  const pending = useRef(false);
  const [submittedUri, setSubmittedUri] = useState("");
  const disabled = !commands.ready || commands.working || !!commands.pending;
  useEffect(() => {
    const intent = commands.pending?.intent;
    if (
      !commands.working &&
      intent?.kind === "source" &&
      intent.file.uri === submittedUri
    )
      onQueued();
  }, [commands.pending, commands.working, onQueued, submittedUri]);
  async function save() {
    if (disabled || pending.current || !body.trim()) return;
    if (body.includes("\0")) {
      setError(uiText("Rimuovi il carattere non valido dal testo."));
      return;
    }
    pending.current = true;
    let file: File | undefined;
    let handedToJournal = false;
    try {
      setError("");
      const name = noteFilename(body);
      file = new File(Paths.cache, "rimiam-note-" + randomUUID() + ".txt");
      file.create();
      file.write(body);
      const attachment = await captureAttachment(file.uri, name);
      handedToJournal = true;
      setSubmittedUri(file.uri);
      if (
        await commands.send({
          kind: "source",
          label: personal ? "Salva nota" : "Condividi nota",
          file: attachment,
          allowModelProcessing: false,
          shareToConversation: true,
        })
      ) {
        handedToJournal = false;
        onSaved(name);
      }
    } catch (e) {
      setError(describe(e));
    } finally {
      pending.current = false;
      if (file && !handedToJournal && file.exists) {
        try {
          file.delete();
        } catch {
          /* The OS owns the cache after a receipt. */
        }
      }
    }
  }
  return (
    <View style={{ gap: 7 }}>
      <Field
        label={uiText("Testo della nota")}
        multiline
        autoFocus
        value={body}
        onChangeText={setBody}
        maxLength={200000}
        editable={!disabled}
      />
      <Text style={{ color: c.muted }}>
        {personal
          ? uiText("Visibile solo a te nella chat personale.")
          : uiText("Visibile in chat ai membri attuali e futuri dello spazio.")}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: c.text }}>
          {error}
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Action
          primary
          label={personal ? uiText("Salva nota") : uiText("Condividi nota")}
          onPress={() => void save()}
          disabled={disabled || !body.trim()}
        />
        <Action
          label={uiText("Chiudi")}
          onPress={onClose}
          disabled={disabled}
        />
      </View>
    </View>
  );
}
