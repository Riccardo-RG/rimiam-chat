import { useUiLanguage } from "./i18n";
import { Recording } from "./calls/Recording";
import { privateMediaCache } from "./private-media-cache";
import React, { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { File } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import {
  attachmentPreviewSchema,
  type AttachmentPreview as Preview,
} from "../../src/contracts/attachment-preview";
import type { NativeRequest } from "./api";
import { Action, usePalette } from "./ui";
import { shareFile } from "./sharedFile";
import { attachmentSize } from "../../src/shared/attachment-size";
import { describe } from "./workspace/useCommands";

/** One protected path for both the preview request and an explicitly requested export. */
export function AttachmentPreview({
  request,
  path,
}: {
  request: NativeRequest;
  path: string;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const viewPath = path + (path.includes("?") ? "&" : "?") + "view=";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    path: string;
    value?: Preview;
    uri?: string;
    error?: string;
  }>();
  const [sharing, setSharing] = useState(false);
  const [exportError, setExportError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    let temporary: File | undefined;
    async function load() {
      try {
        const parsed = attachmentPreviewSchema.safeParse(
          await request(viewPath + "preview", { signal: c.signal }),
        );
        if (c.signal.aborted) return;
        if (!parsed.success)
          throw new Error(
            "Il server ha restituito un’anteprima non leggibile.",
          );
        const value = parsed.data;
        if (value.preview.kind === "image") {
          const bytes = await request.bytes(path, { signal: c.signal });
          if (c.signal.aborted) return;
          const extension =
            value.mediaType === "image/jpeg"
              ? "jpg"
              : value.mediaType === "image/png"
                ? "png"
                : "webp";
          temporary = new File(
            privateMediaCache(),
            randomUUID() + "." + extension,
          );
          temporary.create();
          temporary.write(bytes);
        }
        if (!c.signal.aborted) setState({ path, value, uri: temporary?.uri });
      } catch (e) {
        if (!c.signal.aborted) setState({ path, error: describe(e) });
      }
    }
    setState(undefined);
    setExportError("");
    void load();
    return () => {
      c.abort();
      if (temporary?.exists) temporary.delete();
    };
  }, [viewPath, path, request, attempt]);
  const current = state?.path === path ? state : undefined;
  const f = current?.value;
  if (current?.error)
    return (
      <View style={{ gap: 5 }}>
        <Text style={{ color: p.text }}>{current.error}</Text>
        <Action
          label={uiText("Riprova anteprima")}
          onPress={() => setAttempt((x) => x + 1)}
        />
      </View>
    );
  if (!f)
    return (
      <Text style={{ color: p.muted }}>{uiText("Apertura anteprima…")}</Text>
    );
  async function share() {
    if (!f || sharing) return;
    setSharing(true);
    setExportError("");
    try {
      await shareFile(request, path, f.filename, f.mediaType);
    } catch (e) {
      setExportError(describe(e));
    } finally {
      setSharing(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: p.muted }}>
        {f.mediaType.split(";")[0]} · {attachmentSize(f.bytes)}
      </Text>
      {(f.preview.kind === "image" || f.preview.kind === "page") && (
        <>
          <Image
            resizeMode="contain"
            accessibilityLabel={
              (f.preview.kind === "page" ? "Prima pagina di " : "") + f.filename
            }
            source={{
              uri:
                f.preview.kind === "image"
                  ? current?.uri
                  : "data:image/jpeg;base64," + f.preview.jpeg,
            }}
            style={{ width: "100%", height: 325, backgroundColor: p.panel }}
          />
          {f.preview.kind === "page" && (
            <Text style={{ color: p.muted }}>{uiText("Prima pagina")}</Text>
          )}
        </>
      )}
      {f.preview.kind === "audio" && (
        <Recording
          key={path}
          request={request}
          path={viewPath + "audio"}
          attachment={f.preview.extension}
        />
      )}
      {f.preview.kind === "text" && (
        <>
          <Text
            selectable
            style={{ color: p.text, fontSize: 16, lineHeight: 23 }}
          >
            {f.preview.text}
          </Text>
          {f.preview.truncated && (
            <Text style={{ color: p.muted }}>
              {uiText(
                "Estratto iniziale. Scarica il file per leggere il resto.",
              )}
            </Text>
          )}
        </>
      )}
      {f.preview.kind === "unavailable" && (
        <>
          <Text style={{ color: p.muted }}>
            {f.preview.reason === "busy"
              ? uiText("Il lettore è occupato.")
              : uiText("L’anteprima di questo formato non è disponibile.")}
          </Text>
          {f.preview.reason === "busy" && (
            <Action
              label={uiText("Riprova anteprima")}
              onPress={() => setAttempt((n) => n + 1)}
            />
          )}
        </>
      )}
      <Action
        label={uiText("Esporta originale")}
        disabled={sharing}
        onPress={() => void share()}
      />
      {!!exportError && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
          {exportError}
        </Text>
      )}
    </View>
  );
}
