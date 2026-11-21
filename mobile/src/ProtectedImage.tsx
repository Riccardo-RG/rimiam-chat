import { privateMediaCache } from "./private-media-cache";
import React, { useEffect, useState } from "react";
import { Image, View, type ImageStyle, type StyleProp } from "react-native";
import { File } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import type { NativeRequest } from "./api";

const extensions: Record<string, string> = {
  "image/png": ".png",
  "image/webp": ".webp",
};

/** A displayed, authorized raster never exposes a bearer to an image loader or an external URL. */
export function ProtectedImage({
  request,
  path,
  mediaType,
  label,
  style,
}: {
  request: NativeRequest;
  path: string;
  mediaType: string;
  label: string;
  style: StyleProp<ImageStyle>;
}) {
  const [image, setImage] = useState<{
    path: string;
    request: NativeRequest;
    uri: string;
  }>();
  useEffect(() => {
    const ctrl = new AbortController();
    let file: File | undefined;
    let handle: ReturnType<File["open"]> | undefined;
    async function load() {
      try {
        const extension = extensions[mediaType] ?? ".jpg";
        file = new File(privateMediaCache(), randomUUID() + extension);
        file.create();
        handle = file.open();
        await request.stream(
          path,
          (chunk) => {
            if (!ctrl.signal.aborted) handle?.writeBytes(chunk);
          },
          8 * 1024 * 1024,
          { signal: ctrl.signal },
        );
        handle?.close();
        handle = undefined;
        if (!ctrl.signal.aborted) setImage({ path, request, uri: file.uri });
      } catch {
        // The surrounding file/profile remains usable; previews never grant access.
      } finally {
        if (handle) {
          handle.close();
          handle = undefined;
        }
      }
    }
    void load();
    return () => {
      ctrl.abort();
      if (handle) {
        handle.close();
        handle = undefined;
      }
      if (file?.exists) file.delete();
    };
  }, [request, path, mediaType]);
  return image?.path === path && image.request === request ? (
    <Image
      accessibilityLabel={label}
      source={{ uri: image.uri }}
      resizeMethod="resize"
      resizeMode="cover"
      style={style}
    />
  ) : (
    <View accessible={false} style={style} />
  );
}
