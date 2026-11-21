import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiClient } from "@/api/client";
import { ApiError } from "@/api/client";

/* ------------------------------------------------------------------- api */

const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used inside <AppProviders>");
  return api;
}

/* ----------------------------------------------------------------- theme */

export type ThemeChoice = "light" | "dark" | "system";
export type ThemeMode = "light" | "dark";

const THEME_KEY = "livemap.theme";

function readStoredTheme(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* storage is unavailable in a sandboxed embed */
  }
  return "system";
}

const ThemeContext = createContext<{ choice: ThemeChoice; mode: ThemeMode; setChoice: (c: ThemeChoice) => void } | null>(null);

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used inside <AppProviders>");
  return theme;
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const mode: ThemeMode = choice === "system" ? (systemDark ? "dark" : "light") : choice;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, [mode]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* not persisted; the choice still applies for this visit */
    }
  }, []);

  const value = useMemo(() => ({ choice, mode, setChoice }), [choice, mode, setChoice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/* ------------------------------------------------------------------ root */

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // Refusals are answers, not outages: do not retry them.
        retry: (count, error) => !(error instanceof ApiError && error.code !== "network") && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>{children}</ThemeProvider>
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}
