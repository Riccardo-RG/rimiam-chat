import { useUiLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { createPlaybackFile, type AudioExtension } from "./playback-files";
import { sizeLimit } from "../workspace/commands";
import { View } from "react-native";
import type { NativeRequest } from "../api";
import { describe } from "../workspace/useCommands";
import { Action } from "../ui";
import { Label } from "../integrations/parts";

export function Recording({
  request,
  path,
  attachment,
}: {
  request: NativeRequest;
  path: string;
  attachment?: AudioExtension;
}) {
  const { t: uiText } = useUiLanguage();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const temp = useRef<File | null>(null);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
      const f = temp.current;
      temp.current = null;
      if (f?.exists) f.delete();
    };
  }, []);
  useEffect(() => {
    if (!starting) return;
    if (status.playing || status.didJustFinish) {
      setStarting(false);
      return;
    }
    // Some platform decoders report only idle after a media error. The file is
    // entirely local by now, so a stalled decoder must leave a retryable state.
    const failed = () => {
      player.pause();
      setStarting(false);
      setError(
        uiText("Il dispositivo non riesce a riprodurre questo file audio."),
      );
    };
    if (status.playbackState === "failed") {
      failed();
      return;
    }
    const timer = setTimeout(failed, 8000);
    return () => clearTimeout(timer);
  }, [
    starting,
    status.playing,
    status.didJustFinish,
    status.playbackState,
    uiText,
    player,
  ]);
  async function play() {
    if (lock.current) return;
    lock.current = true;
    setError("");
    setLoading(true);
    try {
      if (status.playing) {
        player.pause();
        return;
      }
      if (!temp.current) {
        abort.current = new AbortController();
        const f = createPlaybackFile(attachment ?? "mp3");
        let complete = false;
        try {
          const handle = f.open();
          try {
            const maximum = Math.min(
              attachment ? sizeLimit : 512 * 1024 * 1024,
              Paths.availableDiskSpace,
            );
            await request.stream(
              path,
              (chunk) => handle.writeBytes(chunk),
              maximum,
              { signal: abort.current.signal },
            );
            complete = alive.current;
          } finally {
            handle.close();
          }
        } finally {
          if (!complete && f.exists) f.delete();
        }
        if (!complete) return;
        temp.current = f;
        player.replace(f.uri);
      } else if (error) {
        player.replace(temp.current.uri);
      }
      if (
        status.didJustFinish ||
        status.playbackState === "ended" ||
        (status.duration > 0 && status.currentTime >= status.duration)
      ) {
        await player.seekTo(0);
      }
      if (alive.current) {
        player.play();
        setStarting(true);
      }
    } catch (e) {
      if (alive.current) setError(describe(e));
    } finally {
      lock.current = false;
      if (alive.current) setLoading(false);
    }
  }
  const busy = loading || (starting && !status.playing);
  const medium = attachment ? "allegato" : "registrazione";
  return (
    <View style={{ gap: 4 }}>
      <Action
        label={
          busy
            ? uiText("Caricamento…")
            : (status.playing ? "Pausa " : "Ascolta ") + medium
        }
        onPress={() => void play()}
        disabled={busy}
      />
      {!!error && <Label>{error}</Label>}
    </View>
  );
}
