import { type CSSProperties, useMemo, useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark";
export type ThemeChoice = ThemeMode | "auto";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function useSystemDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(DARK_QUERY);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DARK_QUERY).matches,
  );
}

export interface ThemeScope {
  mode: ThemeMode;
  /** Put both on the element that wraps everything themed. */
  className: string;
  /** Kept for callers that spread it; the scope is carried by the class alone. */
  style: CSSProperties | undefined;
  /** Changes whenever the colours in scope do, for consumers that cache them. */
  key: string;
}

/**
 * Resolves a theme choice and scopes it to one element, whatever the page
 * around it is set to: a dark map in a light app and a light map in a dark
 * one. tokens.css defines the light values on `:root, .light` and the dark
 * ones on `.dark`, so the nearest class wins and nothing has to be read from
 * a stylesheet at runtime (which a sandboxed or cross-origin frame may refuse).
 */
export function useThemeScope(choice: ThemeChoice): ThemeScope {
  const systemDark = useSystemDark();
  const mode: ThemeMode = choice === "auto" ? (systemDark ? "dark" : "light") : choice;
  return useMemo(() => ({ mode, className: mode, style: undefined, key: mode }), [mode]);
}
