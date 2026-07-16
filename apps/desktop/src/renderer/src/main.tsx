import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/app.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

// Simple locale-aware translate function for ErrorBoundary crash fallback.
// This runs outside the App component tree, so it uses navigator.language directly.
const crashCatalogs: Record<string, Record<string, string>> = {
  en: {
    "errorBoundary.title": "Something went wrong",
    "errorBoundary.description": "Pige encountered an unexpected error. Your knowledge base is safe.",
    "errorBoundary.retry": "Try again"
  },
  "zh-Hans": {
    "errorBoundary.title": "出了点问题",
    "errorBoundary.description": "Pige 遇到了意外错误。你的知识库是安全的。",
    "errorBoundary.retry": "重试"
  },
  ja: {
    "errorBoundary.title": "問題が発生しました",
    "errorBoundary.description": "Pige に予期しないエラーが発生しました。ナレッジベースは安全です。",
    "errorBoundary.retry": "再試行"
  },
  ko: {
    "errorBoundary.title": "문제가 발생했습니다",
    "errorBoundary.description": "Pige에 예기치 않은 오류가 발생했습니다. 지식 베이스는 안전합니다.",
    "errorBoundary.retry": "다시 시도"
  },
  fr: {
    "errorBoundary.title": "Une erreur est survenue",
    "errorBoundary.description": "Pige a rencontré une erreur inattendue. Votre base de connaissances est intacte.",
    "errorBoundary.retry": "Réessayer"
  },
  de: {
    "errorBoundary.title": "Etwas ist schiefgelaufen",
    "errorBoundary.description": "Pige hat einen unerwarteten Fehler festgestellt. Ihre Wissensbasis ist sicher.",
    "errorBoundary.retry": "Erneut versuchen"
  }
};

const detectLocale = (): string => {
  const lang = navigator.language;
  if (lang.startsWith("zh")) return "zh-Hans";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("ko")) return "ko";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("de")) return "de";
  return "en";
};

const crashTranslate = (key: string): string => {
  const locale = detectLocale();
  const catalog = crashCatalogs[locale] ?? crashCatalogs["en"]!;
  return catalog[key] ?? key;
};

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary translate={crashTranslate}>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
