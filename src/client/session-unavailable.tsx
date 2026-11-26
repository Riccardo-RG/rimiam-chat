"use client";

import { useEffect } from "react";
import { sessionRetryDelay } from "./auth-client";
import { LoadingStatus } from "./loading-status";
import { useUiLanguage } from "./ui-language";
import styles from "./loading-status.module.css";

export function SessionUnavailable({
  throttled,
  retry,
}: {
  throttled: boolean;
  retry: () => Promise<void>;
}) {
  const { t: uiText } = useUiLanguage();
  useEffect(() => {
    if (!throttled) return;
    const timer = window.setTimeout(() => void retry(), sessionRetryDelay());
    return () => window.clearTimeout(timer);
  }, [throttled, retry]);
  if (throttled)
    return (
      <LoadingStatus fullPage label={uiText("Verifica della sessione…")} />
    );
  return (
    <main className={styles.page}>
      <p role="alert">{uiText("Verifica della sessione non riuscita.")}</p>
      <button type="button" onClick={() => void retry()}>
        {uiText("Riprova")}
      </button>
    </main>
  );
}
