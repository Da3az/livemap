import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useSearchParams } from "react-router";
import { startEmbedChild } from "@/embed/protocol";
import { LOCALE } from "@/i18n";
import { EMBED_STRINGS } from "@/i18n/embed";
import { langForDir } from "@/render/furniture";
import { EmbedLoading, EmbedStatement } from "./states";
import { type ThemeChoice, type ThemeMode, useThemeScope } from "./theme-scope";
import { useLiveMap } from "./use-live-map";
import { MapViewer } from "./viewer";

/** The pointer is cached for five seconds; asking every ten keeps a reader within one cycle of the desk. */
const POLL_MS = 10_000;

function readFlag(value: string | null): boolean | undefined {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}

function readTheme(value: string | null): ThemeChoice | undefined {
  return value === "light" || value === "dark" || value === "auto" ? value : undefined;
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
  );
}

/**
 * The embed is its own page, so the page takes the map's theme. The app's
 * theme provider also writes this class, from a choice a reader never made;
 * this keeps the document on the embed's theme whatever that provider does.
 */
function useDocumentTheme(mode: ThemeMode): void {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (root.classList.contains("dark") !== (mode === "dark")) root.classList.toggle("dark", mode === "dark");
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [mode]);
}

/** What a reader sees in an article's iframe: the published map and nothing else. */
export default function Embed() {
  const { tenant, slug } = useParams();
  const [params] = useSearchParams();
  const themeParam = readTheme(params.get("theme"));
  const embedId = params.get("embedId");

  /* With `embedId` the host page's script grows the frame when the map's furniture does not fit it. */
  useEffect(() => {
    if (embedId === null) return;
    return startEmbedChild({ id: embedId, target: document.body });
  }, [embedId]);
  const published = useLiveMap(tenant, slug, { pollMs: POLL_MS });
  const online = useOnline();
  const version = published.data ?? null;

  const theme = themeParam ?? version?.settings.embed.theme ?? "auto";
  const { mode } = useThemeScope(theme);
  useDocumentTheme(mode);

  /* The first version is simply the map; only a later one is an update worth a word. */
  const seen = useRef<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!version) return;
    if (seen.current !== null && seen.current !== version.version) setUpdatedAt(Date.now());
    seen.current = version.version;
  }, [version]);

  useEffect(() => {
    if (version) document.title = version.title.value;
  }, [version]);

  /* Back online: do not wait for the next poll. */
  const { refetch } = published;
  useEffect(() => {
    if (online) void refetch();
  }, [online, refetch]);

  if (version) {
    const lang = langForDir(version.uiDir);
    const t = EMBED_STRINGS[lang];
    const clock = updatedAt === null ? null : new Intl.DateTimeFormat(LOCALE[lang], { hour: "2-digit", minute: "2-digit" }).format(updatedAt);
    const note = !online ? t.offlineStale : published.isError ? t.updateFailed : clock ? t.updated(clock) : null;
    return (
      <main className="h-dvh">
        <MapViewer
          version={version}
          theme={theme}
          static={readFlag(params.get("static"))}
          legend={readFlag(params.get("legend"))}
          panButtons={readFlag(params.get("pan"))}
          fullscreen
          note={note ? <span role="status">{note}</span> : null}
          className="h-full"
        />
      </main>
    );
  }

  if (published.isPending) {
    return online ? <EmbedLoading /> : <EmbedStatement kind="offline" />;
  }
  if (published.isError) {
    if (published.error?.code === "not_found") return <EmbedStatement kind="notFound" />;
    if (!online || published.error?.code === "network") {
      return <EmbedStatement kind={online ? "failed" : "offline"} busy={published.isFetching} onRetry={online ? () => void refetch() : undefined} />;
    }
    return <EmbedStatement kind="failed" busy={published.isFetching} onRetry={() => void refetch()} />;
  }
  return <EmbedStatement kind="notPublished" />;
}
