import { createContext, useContext, type ReactNode } from "react";

/** The interface language. The app shell is English; the editor follows the map's direction. */
export type Lang = "en" | "ar";

const LangContext = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/**
 * Each area keeps its own dictionary file (src/i18n/<area>.ts) so screens can
 * be built independently. `defineStrings` checks that both languages have the
 * same keys and returns a hook.
 */
export function defineStrings<T extends Record<string, unknown>>(dict: { en: T; ar: T }): () => T {
  return () => dict[useLang()];
}

/** Western digits in both languages; Arabic month and unit names in Arabic. */
export const LOCALE: Record<Lang, string> = { en: "en-GB", ar: "ar-u-nu-latn" };
