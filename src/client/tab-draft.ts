"use client";
import { useEffect, useState, type SetStateAction } from "react";

// Reload recovery within one tab and authenticated session. These local values
// never authorize a send: the journal and server receipt own the operation.
export function useTabDraft<T>(key: string, empty: T) {
  function read(): T {
    try {
      const raw = sessionStorage.getItem(key);
      return raw === null ? empty : (JSON.parse(raw) as T);
    } catch {
      return empty;
    }
  }
  const [entry, setEntry] = useState(() => ({ key, value: read() }));
  if (entry.key !== key) setEntry({ key, value: read() });
  useEffect(() => {
    if (entry.key !== key) return;
    try {
      if (
        entry.value === null ||
        (typeof entry.value === "object" &&
          "text" in entry.value &&
          !entry.value.text)
      )
        sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(entry.value));
    } catch {
      /* An unavailable browser store still permits the in-memory editor. */
    }
  }, [key, entry]);
  function setValue(next: SetStateAction<T>) {
    setEntry((current) => {
      if (current.key !== key) return current;
      const value =
        typeof next === "function"
          ? (next as (state: T) => T)(current.value)
          : next;
      return Object.is(value, current.value) ? current : { key, value };
    });
  }
  return [entry.key === key ? entry.value : empty, setValue] as const;
}
