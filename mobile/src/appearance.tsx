import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
const modes = ["system", "light", "dark"] as const;
const accents = ["neutral", "ocean", "forest", "plum"] as const;
type Preferences = {
  mode: (typeof modes)[number];
  accent: (typeof accents)[number];
  showToday?: boolean;
};
const initial: Preferences = { mode: "system", accent: "neutral" };
const context = createContext<{
  settings: Preferences;
  dark: boolean;
  save: (value: Preferences) => void;
}>({
  settings: initial,
  dark: false,
  save: () => {},
});
const key = "rimiam.appearance.v1";
export function Appearance({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(initial);
  const system = useColorScheme();
  const edited = useRef(false);
  const writing = useRef(Promise.resolve());
  useEffect(() => {
    let current = true;
    void SecureStore.getItemAsync(key)
      .then((raw) => {
        if (!raw || !current || edited.current) return;
        const stored = JSON.parse(raw);
        if (modes.includes(stored.mode) && accents.includes(stored.accent))
          setSettings(stored);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  function save(value: Preferences) {
    edited.current = true;
    setSettings(value);
    writing.current = writing.current
      .then(() => SecureStore.setItemAsync(key, JSON.stringify(value)))
      .catch(() => undefined);
  }
  return (
    <context.Provider
      value={{
        settings,
        dark:
          settings.mode === "dark" ||
          (settings.mode === "system" && system === "dark"),
        save,
      }}
    >
      {children}
    </context.Provider>
  );
}
export const useAppearance = () => useContext(context);
