import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useUiLanguage } from "./i18n";
import { type NativeRequest, problem } from "./api";

export function useResource<T>(
  request: NativeRequest,
  path: string,
  pollMs = 0,
  enabled = true,
) {
  const { t } = useUiLanguage();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    path: string;
    request: NativeRequest;
    value?: T;
    failure?: { cause: unknown };
  }>();
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let read: AbortController | undefined;
    function load() {
      if (
        AppState.currentState === "background" ||
        (read && !read.signal.aborted)
      )
        return;
      const controller = new AbortController();
      read = controller;
      request<T>(path, { signal: controller.signal })
        .then((value) => {
          if (!controller.signal.aborted) setResult({ path, request, value });
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setResult({ path, request, failure: { cause } });
        })
        .finally(() => {
          if (read === controller) read = undefined;
        });
    }
    load();
    const timer = pollMs ? setInterval(load, pollMs) : undefined;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") load();
      else read?.abort();
    });
    return () => {
      read?.abort();
      clearInterval(timer);
      sub.remove();
    };
  }, [request, path, revision, pollMs, enabled]);
  const current =
    enabled && result?.path === path && result.request === request
      ? result
      : undefined;
  return {
    value: current?.value,
    error: current?.failure ? problem(current.failure.cause, t) : undefined,
    refresh,
  };
}
