import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SupportedLocale } from "@gadgets/workshop-shared/api";
import { LOCALE_STORAGE_KEY, LocaleProvider } from "../i18n/LocaleProvider";
import i18n from "../i18n/i18n";

export type LocaleRenderResult = {
  container: HTMLDivElement;
  unmount: () => void;
};

/** Render a component under the production LocaleProvider for frontend tests. */
export function renderWithLocale(
  children: ReactNode,
  locale: SupportedLocale = "en",
): LocaleRenderResult {
  const previousStorage = localStorage.getItem(LOCALE_STORAGE_KEY);
  const previousLanguage = i18n.language;
  const previousDocumentLanguage = document.documentElement.lang;
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(createElement(LocaleProvider, null, children));
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
      if (previousStorage === null) {
        localStorage.removeItem(LOCALE_STORAGE_KEY);
      } else {
        localStorage.setItem(LOCALE_STORAGE_KEY, previousStorage);
      }
      void i18n.changeLanguage(previousLanguage);
      document.documentElement.lang = previousDocumentLanguage;
    },
  };
}
