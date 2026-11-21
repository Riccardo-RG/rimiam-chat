"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useSyncExternalStore } from "react";
import { LanguageControl } from "./ui-language";
import { WorkspaceIcon } from "./workspace-icon";

const choices = {
  "rimiam-appearance": ["system", "light", "dark"],
  "rimiam-accent": ["neutral", "ocean", "forest", "plum"],
} as const;
type Preference = keyof typeof choices;
const sessionFallback: Partial<Record<Preference, string>> = {};
const changed = "rimiam-appearance-changed";

function read(key: Preference): string {
  let value = sessionFallback[key];
  if (value === undefined) {
    try {
      value = localStorage.getItem(key) ?? undefined;
    } catch {
      // Preferences still work for this page when storage is unavailable.
    }
  }
  return choices[key].find((option) => option === value) ?? choices[key][0];
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changed, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changed, listener);
  };
}
function usePreference(key: Preference) {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => choices[key][0],
  );
}
function save(key: Preference, value: string) {
  try {
    localStorage.setItem(key, value);
    delete sessionFallback[key];
  } catch {
    sessionFallback[key] = value;
  }
  window.dispatchEvent(new Event(changed));
}
export function AppearanceRoot() {
  const mode = usePreference("rimiam-appearance");
  const accent = usePreference("rimiam-accent");
  useEffect(() => {
    // Read the live values on hydration as well as subsequent preference changes.
    document.documentElement.dataset.appearance = read("rimiam-appearance");
    document.documentElement.dataset.accent = read("rimiam-accent");
  }, [mode, accent]);
  useEffect(() => {
    const root = document.documentElement;
    const pointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.pointerType === "pen")
        root.dataset.touchFocus = "";
      else delete root.dataset.touchFocus;
    };
    const keyboard = () => {
      delete root.dataset.touchFocus;
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
      keyboard();
    };
  }, []);
  return null;
}
export function AppearanceToggle({ className }: { className?: string }) {
  const { t: uiText } = useUiLanguage();
  const appearance = usePreference("rimiam-appearance");
  return (
    <button
      type="button"
      className={className}
      title={uiText("Cambia tema")}
      aria-label={uiText("Cambia tema")}
      onClick={() => {
        const dark =
          appearance === "dark" ||
          (appearance === "system" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);
        save("rimiam-appearance", dark ? "light" : "dark");
      }}
    >
      <WorkspaceIcon name="theme" />
    </button>
  );
}
export function AppearanceControl({
  showAccent = false,
}: {
  showAccent?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const appearance = usePreference("rimiam-appearance");
  const accent = usePreference("rimiam-accent");
  return (
    <>
      <LanguageControl />
      <label className="appearance-control">
        {uiText("Aspetto")}
        <select
          aria-label={uiText("Aspetto dell’app")}
          value={appearance}
          onChange={(event) => save("rimiam-appearance", event.target.value)}
        >
          <option value="system">{uiText("Come il dispositivo")}</option>
          <option value="light">{uiText("Chiaro")}</option>
          <option value="dark">{uiText("Scuro")}</option>
        </select>
      </label>
      {showAccent && (
        <label className="appearance-control">
          {uiText("Colore di accento")}
          <select
            value={accent}
            onChange={(event) => save("rimiam-accent", event.target.value)}
          >
            <option value="neutral">{uiText("Grafite")}</option>
            <option value="ocean">{uiText("Blu oceano")}</option>
            <option value="forest">{uiText("Verde bosco")}</option>
            <option value="plum">{uiText("Prugna")}</option>
          </select>
        </label>
      )}
    </>
  );
}
