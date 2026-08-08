import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./resources/en";
import zhCN from "./resources/zh-CN";

// i18next exposes `use` on its default singleton; the named export is a different API.
// oxlint-disable-next-line import/no-named-as-default-member
void i18n.use(initReactI18next).init({
  fallbackLng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
  lng: "en",
  parseMissingKeyHandler: (key) => {
    const fallback = i18n.getResource("en", "translation", key);
    return typeof fallback === "string" ? fallback : "";
  },
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
});

export default i18n;
