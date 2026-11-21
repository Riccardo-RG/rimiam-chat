"use client";

import { useRef, useState } from "react";
import {
  assistantFailureText,
  type AssistantRequestFailure,
} from "../shared/assistant-request-failures";
import { errors } from "./api";
import { useUiLanguage } from "./ui-language";
import styles from "./assistant-request-feedback.module.css";

export function AssistantRequestFeedback({
  failure,
  canRetry,
  disabled,
  retry,
}: {
  failure: AssistantRequestFailure;
  canRetry: boolean;
  disabled: boolean;
  retry: (interpretationId: string) => Promise<unknown>;
}) {
  const { t } = useUiLanguage();
  const pending = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  async function retryOriginal() {
    if (pending.current || disabled || !canRetry || !failure.retryable) return;
    pending.current = true;
    setRetrying(true);
    setError("");
    try {
      await retry(failure.interpretationId);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(
        Object.hasOwn(errors, code) ? errors[code] : errors.REQUEST_FAILED,
      );
    } finally {
      pending.current = false;
      setRetrying(false);
    }
  }
  return (
    <div className={styles.feedback}>
      <small role="status">
        {assistantFailureText(failure.reason, failure.displayName, t)}
        {error && <span className={styles.error}>{t(error)}</span>}
      </small>
      {canRetry && failure.retryable && (
        <button
          type="button"
          className="quiet"
          aria-label={t("Riprova questa richiesta a ") + failure.displayName}
          disabled={disabled || retrying}
          onClick={() => void retryOriginal()}
        >
          {t("Riprova")}
        </button>
      )}
    </div>
  );
}
