import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, I18nManager, Platform, Settings } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  languagePreference,
  resolveUiLocale,
  translateUi,
  type UiLocale,
  type LanguagePreference,
} from "../../src/shared/i18n";

type TextParameters = (string | number)[];
type Language = {
  locale: UiLocale;
  preference: LanguagePreference;
  setLocale: (preference: LanguagePreference) => void;
  storageFailed: boolean;
  t: (source: string, ...values: TextParameters) => string;
};

const LanguageContext = createContext<Language | null>(null);
const languageKey = "rimiam.ui-language.v1";

function deviceLanguages(): string[] {
  if (Platform.OS === "ios") {
    const languages: unknown = Settings.get("AppleLanguages");
    if (Array.isArray(languages) && languages.length)
      return languages.filter(
        (value): value is string => typeof value === "string",
      );
  } else if (Platform.OS === "android") {
    const tag = I18nManager.getConstants().localeIdentifier;
    if (tag) return [tag];
  }
  return [Intl.DateTimeFormat().resolvedOptions().locale];
}

export function NativeLanguageProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preference, setPreference] = useState<LanguagePreference>("system");
  const [device, setDevice] = useState(deviceLanguages);
  const [ready, setReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const writes = useRef(Promise.resolve());
  const latest = useRef(0);
  const locale = resolveUiLocale(preference, device);

  useEffect(() => {
    let mounted = true;
    void SecureStore.getItemAsync(languageKey)
      .then((value) => {
        if (mounted) setPreference(languagePreference(value));
      })
      .catch(() => {
        if (mounted) setStorageFailed(true);
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    const changes = AppState.addEventListener("change", (state) => {
      if (state === "active") setDevice(deviceLanguages());
    });
    return () => {
      mounted = false;
      changes.remove();
    };
  }, []);

  const setLocale = useCallback((next: LanguagePreference) => {
    setPreference(next);
    setDevice(deviceLanguages());
    setStorageFailed(false);
    const revision = ++latest.current;
    writes.current = writes.current
      .then(() => SecureStore.setItemAsync(languageKey, next))
      .catch(() => {
        if (revision === latest.current) setStorageFailed(true);
      });
  }, []);

  const t = useCallback(
    (source: string, ...values: TextParameters) =>
      translateUi(locale, source, ...values),
    [locale],
  );
  const value = useMemo(
    () => ({ locale, preference, setLocale, storageFailed, t }),
    [locale, preference, setLocale, storageFailed, t],
  );
  return (
    <LanguageContext.Provider value={value}>
      {ready ? children : null}
    </LanguageContext.Provider>
  );
}

export function useUiLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("NativeLanguageProvider is required.");
  return value;
}
