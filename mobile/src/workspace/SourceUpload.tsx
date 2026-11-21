import { useUiLanguage } from "../i18n";
import React, { useRef, useState } from "react";
import { Switch, Text, View } from "react-native";
import * as Documents from "expo-document-picker";
import {
  optionalMediaReading,
  validateAttachment,
} from "../../../src/shared/attachment-format";
import { Action, usePalette } from "../ui";
import { captureAttachment, type Attachment } from "./commands";
import { describe, type Commands } from "./useCommands";

export function SourceUpload({
  commands,
  personalChat = false,
}: {
  commands: Commands;
  personalChat?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const [file, setFile] = useState<Attachment | null>(null);
  const [allow, setAllow] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const disabled = commands.working || !!commands.pending || !commands.ready;
  async function choose() {
    if (disabled || lock.current) return;
    lock.current = true;
    setError("");
    try {
      const result = await Documents.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const item = result.assets[0];
      const selected = await captureAttachment(item.uri, item.name);
      validateAttachment({ name: item.name, size: selected.size });
      setAllow(false);
      setFile(selected);
    } catch (e) {
      setError(
        e instanceof Error && e.message === "DOCUMENT_FORMAT_UNSUPPORTED"
          ? uiText("Questo formato non è supportato.")
          : describe(e),
      );
    } finally {
      lock.current = false;
    }
  }
  return (
    <View style={{ gap: 6 }}>
      {!file && (
        <Action
          label={
            personalChat ? uiText("Scegli file") : uiText("Carica una fonte")
          }
          onPress={() => void choose()}
          disabled={disabled}
        />
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: p.text }}>
          {error}
        </Text>
      )}
      {file && (
        <>
          <Text style={{ color: p.text }}>{file.filename}</Text>
          <Text style={{ color: p.muted }}>
            {personalChat
              ? uiText("Il file sarà visibile solo a te nella chat personale.")
              : uiText(
                  "La fonte sarà leggibile anche da chi entrerà in questo spazio.",
                )}
          </Text>
          {optionalMediaReading(file.filename) && (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Switch
                value={allow}
                onValueChange={setAllow}
                disabled={disabled}
                accessibilityLabel={uiText("Consenti lettura con AI")}
              />
              <Text style={{ color: p.text, flex: 1 }}>
                {uiText(
                  "Consenti al servizio AI configurato di leggere questo file.",
                )}
              </Text>
            </View>
          )}
          <Action
            label={
              personalChat
                ? uiText("Salva nella chat personale")
                : uiText("Condividi tra le fonti")
            }
            disabled={disabled}
            primary
            onPress={async () => {
              if (
                await commands.send({
                  kind: "source",
                  label: personalChat
                    ? "Salva allegato personale"
                    : "Carica una fonte",
                  ...(personalChat && { shareToConversation: true as const }),
                  file,
                  allowModelProcessing:
                    allow && optionalMediaReading(file.filename),
                })
              ) {
                setFile(null);
                setAllow(false);
              }
            }}
          />
          <Action
            label={uiText("Annulla")}
            disabled={commands.working}
            onPress={() => {
              setFile(null);
              setAllow(false);
              setError("");
            }}
          />
        </>
      )}
    </View>
  );
}
