import { useUiLanguage } from "../i18n";
import React, { useRef, useState } from "react";
import { View, Text } from "react-native";
import * as Documents from "expo-document-picker";
import * as Photos from "expo-image-picker";
import { Action, usePalette } from "../ui";
import { captureAttachment, sizeLimit, type Attachment } from "./commands";
import { describe } from "./useCommands";

type AttachmentProps = {
  files: Attachment[];
  onChange: (next: Attachment[]) => void;
  disabled?: boolean;
};

export function useAttachmentPicker({
  files,
  onChange,
  disabled = false,
}: AttachmentProps) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function pick(camera: boolean) {
    if (lock.current || disabled) return;
    lock.current = true;
    setPicking(true);
    setError("");
    try {
      let selected: { uri: string; name: string }[];
      if (camera) {
        const permission = await Photos.requestCameraPermissionsAsync();
        if (!permission.granted)
          throw new Error(
            "Consenti l’accesso alla fotocamera nelle impostazioni del telefono.",
          );
        const result = await Photos.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.85,
        });
        if (result.canceled) return;
        selected = result.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName || a.uri.split("/").pop() || "Foto.jpg",
        }));
      } else {
        const result = await Documents.getDocumentAsync({
          multiple: true,
          copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        selected = result.assets;
      }
      if (files.length + selected.length > 10)
        throw new Error("Puoi condividere fino a 10 allegati per messaggio.");
      const next = [...files];
      let size = files.reduce((n, f) => n + f.size, 0);
      for (const file of selected) {
        const item = await captureAttachment(file.uri, file.name);
        size += item.size;
        if (size > sizeLimit)
          throw new Error("Gli allegati superano gli 8 MiB complessivi.");
        next.push(item);
      }
      onChange(next);
    } catch (e) {
      setError(describe(e));
    } finally {
      lock.current = false;
      setPicking(false);
    }
  }
  return { pick, picking, error };
}
export function Attachments(props: AttachmentProps) {
  const picker = useAttachmentPicker(props);
  return <AttachmentFields {...props} picker={picker} />;
}
export function AttachmentFields({
  files,
  onChange,
  disabled,
  picker: { pick, picking, error },
}: AttachmentProps & { picker: ReturnType<typeof useAttachmentPicker> }) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Action
          label={uiText("Scegli file")}
          disabled={picking || disabled}
          onPress={() => void pick(false)}
        />
        <Action
          label={uiText("Scatta foto")}
          disabled={picking || disabled}
          onPress={() => void pick(true)}
        />
      </View>
      {files.map((file, i) => (
        <View
          key={file.uri + i}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Text numberOfLines={2} style={{ color: p.text, flex: 1 }}>
            {file.filename}
          </Text>
          <Action
            label={uiText("Rimuovi")}
            disabled={picking || disabled}
            onPress={() => onChange(files.filter((_, j) => j !== i))}
          />
        </View>
      ))}
      {!!error && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
          {error}
        </Text>
      )}
    </View>
  );
}
