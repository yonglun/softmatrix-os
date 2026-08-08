import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SupportedLocale } from "@gadgets/workshop-shared/api";
import i18n from "./i18n";
import { detectLocale, isSupportedLocale } from "./locales";

export const LOCALE_STORAGE_KEY = "softmatrix.locale";

export type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readInitialLocale(): SupportedLocale {
  if (typeof window !== "undefined") {
    try {
      const persisted = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isSupportedLocale(persisted)) return persisted;
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }

  const languages = typeof navigator !== "undefined" ? navigator.languages : [];
  return detectLocale(languages);
}

function syncLocale(locale: SupportedLocale): void {
  void i18n.changeLanguage(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

function persistLocale(locale: SupportedLocale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function initializeLocale(): SupportedLocale {
  const initialLocale = readInitialLocale();
  // Run before returning the provider element so descendants using useTranslation()
  // see the selected language on their first render rather than one effect later.
  syncLocale(initialLocale);
  persistLocale(initialLocale);
  return initialLocale;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(initializeLocale);

  const setLocale = useCallback((nextLocale: SupportedLocale) => {
    if (!isSupportedLocale(nextLocale)) return;
    syncLocale(nextLocale);
    persistLocale(nextLocale);
    setLocaleState(nextLocale);
  }, []);

  useEffect(() => {
    syncLocale(locale);
    persistLocale(locale);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
