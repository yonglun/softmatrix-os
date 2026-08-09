// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { LocaleProvider, useLocale } from "./LocaleProvider";

function Probe() {
  const { locale, setLocale } = useLocale();
  return createElement(
    "button",
    { type: "button", onClick: () => setLocale(locale === "en" ? "zh-CN" : "en") },
    locale,
  );
}

function TranslationProbe() {
  const { t } = useTranslation();
  const value = t("common.save");
  if (firstTranslation === undefined) firstTranslation = value;
  return createElement("span", null, value);
}

let firstTranslation: string | undefined;

function render(children: ReactNode): { root: Root; container: HTMLDivElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(LocaleProvider, null, children)));
  return { root, container };
}

describe("LocaleProvider", () => {
  let rendered: { root: Root; container: HTMLDivElement } | undefined;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "en";
    void i18n.changeLanguage("en");
  });

  afterEach(() => {
    rendered?.root.unmount();
    rendered?.container.remove();
    rendered = undefined;
    localStorage.clear();
  });

  it("uses a supported persisted locale and syncs the document", async () => {
    localStorage.setItem("softmatrix.locale", "zh-CN");
    rendered = render(createElement(Probe));

    await act(async () => {});

    expect(rendered.container.textContent).toBe("zh-CN");
    expect(i18n.language).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("makes the selected language available on the first child render", () => {
    localStorage.setItem("softmatrix.locale", "zh-CN");
    firstTranslation = undefined;
    rendered = render(createElement(TranslationProbe));

    expect(firstTranslation).toBe("保存");
    expect(rendered.container.textContent).toBe("保存");
  });

  it("ignores unsupported persisted values and uses browser detection", async () => {
    localStorage.setItem("softmatrix.locale", "fr-FR");
    rendered = render(createElement(Probe));

    await act(async () => {});

    expect(rendered.container.textContent).toBe("en");
    expect(localStorage.getItem("softmatrix.locale")).toBe("en");
  });

  it("persists locale changes and updates i18next and document lang", async () => {
    rendered = render(createElement(Probe));
    const button = rendered.container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(rendered.container.textContent).toBe("zh-CN");
    expect(localStorage.getItem("softmatrix.locale")).toBe("zh-CN");
    expect(i18n.language).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
