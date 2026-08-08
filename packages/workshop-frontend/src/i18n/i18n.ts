import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./resources/en";
import zhCN from "./resources/zh-CN";

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
