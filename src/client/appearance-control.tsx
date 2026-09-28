"use client";
import { useEffect, useSyncExternalStore } from "react";

const key = "rimiam-appearance";
let localChoice = "system";
const read = () => {
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return localChoice;
  }
};
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(key, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(key, listener);
  };
}
export function AppearanceControl() {
  const appearance = useSyncExternalStore(subscribe, read, () => "system");
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);
  return (
    <label className="appearance-control">
      Aspetto
      <select
        aria-label="Aspetto dell’app"
        value={appearance}
        onChange={(event) => {
          localChoice = event.target.value;
          try {
            localStorage.setItem(key, event.target.value);
          } catch {
            /* Keep the explicit choice for this page when storage is unavailable. */
          }
          window.dispatchEvent(new Event(key));
        }}
      >
        <option value="system">Come il dispositivo</option>
        <option value="light">Chiaro</option>
        <option value="dark">Scuro</option>
      </select>
    </label>
  );
}
