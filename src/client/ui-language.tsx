"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  languagePreference,
  resolveUiLocale,
  translateUi,
  type LanguagePreference,
  type UiLocale,
} from "../shared/i18n";
const key = "rimiam-ui-language";
type Selection = {
  preference: LanguagePreference;
  locale: UiLocale;
  setLocale: (value: LanguagePreference) => void;
  t: (source: string, ...args: (string | number)[]) => string;
};
// Standalone previews and server-rendered fragments use the source language.
const Context = createContext<Selection>({
  preference: "system",
  locale: "it",
  t: (source, ...args) => translateUi("it", source, ...args),
  setLocale: () => {
    throw new Error("Changing language requires WebLanguageProvider");
  },
});
export function WebLanguageProvider({
  children,
  initial,
  initialLocale,
}: {
  children: ReactNode;
  initial: LanguagePreference;
  initialLocale: UiLocale;
}) {
  const [pref, setPref] = useState(initial),
    [system, setSystem] = useState(initialLocale);
  const pathname = usePathname(),
    router = useRouter();
  useEffect(() => {
    const update = () =>
      setSystem(resolveUiLocale("system", navigator.languages));
    const sync = (e: StorageEvent) => {
      if (e.key === key) setPref(languagePreference(e.newValue));
    };
    update();
    document.documentElement.lang = resolveUiLocale(pref, navigator.languages);
    window.addEventListener("languagechange", update);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("languagechange", update);
      window.removeEventListener("storage", sync);
    };
  }, [pref]);
  const locale = pref === "system" ? system : pref;
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback(
    (value: LanguagePreference) => {
      setPref(value);
      document.cookie =
        key +
        "=" +
        value +
        "; Path=/; SameSite=Lax; Max-Age=31536000" +
        (location.protocol === "https:" ? "; Secure" : "");
      try {
        localStorage.setItem(key, value);
      } catch {
        /* The selection still works in this tab. */
      }
      if (
        pathname === "/beta" ||
        pathname === "/connessioni-e-dati" ||
        pathname?.startsWith("/account/")
      )
        router.refresh();
    },
    [pathname, router],
  );
  const t = useCallback(
    (source: string, ...args: (string | number)[]) =>
      translateUi(locale, source, ...args),
    [locale],
  );
  return (
    <Context.Provider
      value={useMemo(
        () => ({ locale, preference: pref, setLocale, t }),
        [locale, pref, setLocale, t],
      )}
    >
      {children}
    </Context.Provider>
  );
}
export function useUiLanguage() {
  return useContext(Context);
}
export function LanguageControl() {
  const { locale, preference, setLocale } = useUiLanguage();
  return (
    <label className="appearance-control">
      {locale === "en" ? "Language" : "Lingua"}
      <select
        value={preference}
        onChange={(e) => setLocale(languagePreference(e.currentTarget.value))}
      >
        <option value="system">
          {locale === "en" ? "Device language" : "Lingua del dispositivo"}
        </option>
        <option value="it" lang="it">
          Italiano
        </option>
        <option value="en" lang="en">
          English
        </option>
      </select>
    </label>
  );
}
