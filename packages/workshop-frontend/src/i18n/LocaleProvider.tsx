import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupportedLocale } from "@gadgets/workshop-shared/api";
import type { AuthenticatedApi } from "@gadgets/workshop-shared/api";
import type { RpcStub } from "capnweb";
import i18n from "./i18n";
import { detectLocale, isSupportedLocale } from "./locales";

export const LOCALE_STORAGE_KEY = "softmatrix.locale";

export type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => Promise<void>;
  /** Internal bridge for applying a server preference without writing it back. */
  setLocaleLocally: (locale: SupportedLocale) => void;
  /** Internal bridge used by AuthProvider to attach the current authenticated RPC stub. */
  registerAuthenticatedApi: (api: RpcStub<AuthenticatedApi> | null) => void;
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
  const selectedLocale = readInitialLocale();
  // Run before returning the provider element so descendants using useTranslation()
  // see the selected language on their first render rather than one effect later.
  syncLocale(selectedLocale);
  persistLocale(selectedLocale);
  return selectedLocale;
}

export function LocaleProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<SupportedLocale>(initializeLocale);
  const authenticatedApiRef = useRef<RpcStub<AuthenticatedApi> | null>(null);
  const registerAuthenticatedApi = useCallback((api: RpcStub<AuthenticatedApi> | null) => {
    authenticatedApiRef.current = api;
  }, []);

  const setLocaleLocally = useCallback((nextLocale: SupportedLocale) => {
    if (!isSupportedLocale(nextLocale)) return;
    syncLocale(nextLocale);
    persistLocale(nextLocale);
    setLocaleState(nextLocale);
  }, []);

  const setLocale = useCallback((nextLocale: SupportedLocale) => {
    setLocaleLocally(nextLocale);
    const authenticatedApi = authenticatedApiRef.current;
    return authenticatedApi ? authenticatedApi.setLocale(nextLocale) : Promise.resolve();
  }, [setLocaleLocally]);

  useEffect(() => {
    syncLocale(locale);
    persistLocale(locale);
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, setLocaleLocally, registerAuthenticatedApi }),
    [locale, setLocale, setLocaleLocally, registerAuthenticatedApi],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
