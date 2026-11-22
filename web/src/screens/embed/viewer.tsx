import { cn } from "cn";
import type { ReactNode, Ref } from "react";
import { LangProvider } from "@/i18n";
import { useEmbedStrings } from "@/i18n/embed";
import type { IsoDateTime, MapVersion, RichText, Viewport } from "@/model/types";
import { formatAsOf, langForDir, sourceLine } from "@/render/furniture";
import { MapStage, type MapViewerHandle } from "./stage";
import { useThemeScope } from "./theme-scope";
import { ReaderTimeline } from "./timeline";
import { usePlayback } from "./use-playback";

export type { MapViewerHandle } from "./stage";

export interface MapViewerProps {
  /** The artifact to show. A newer version of the same map is swapped in place: the view and the playhead stay. */
  version: MapVersion;
  /** Overrides `version.settings.embed.theme`; "auto" follows the reader's system. */
  theme?: "light" | "dark" | "auto";
  className?: string;
  /** Overrides `settings.embed.static`: a picture, with no pan, zoom or controls. */
  static?: boolean;
  /** Overrides `settings.embed.legend`. */
  legend?: boolean;
  zoomButtons?: boolean;
  /** Overrides `settings.embed.panButtons`. */
  panButtons?: boolean;
  scaleBar?: boolean;
  /** Offer a full-screen button: the embed page only. */
  fullscreen?: boolean;
  /** "map" leaves out the title, the timeline and the credit line, for showing two versions side by side. */
  furniture?: "full" | "map";
  /** Where the timeline starts; the end of the map's span when left out. */
  initialTime?: IsoDateTime;
  /** Width of the moving window. The artifact does not carry it; the editor's preview passes its own. */
  timeWindowMs?: number;
  /** Features to outline. */
  highlightIds?: readonly string[];
  /** A quiet line after the "as of" stamp, such as when the embed last updated. */
  note?: ReactNode;
  /** Where the map opens, when that is not the artifact's own opening view. */
  initialViewport?: Viewport;
  handleRef?: Ref<MapViewerHandle>;
  onViewport?: (viewport: Viewport) => void;
}

const NO_IDS: readonly string[] = [];

/* Links required by the basemap's licence, as its tile source words them. */
const ATTRIBUTION = [
  { href: "https://openfreemap.org", text: "OpenFreeMap" },
  { href: "https://www.openmaptiles.org/", text: "© OpenMapTiles" },
] as const;
const OSM = { href: "https://www.openstreetmap.org/copyright", text: "OpenStreetMap" } as const;

function Line({ text, className }: { text: RichText; className?: string }) {
  return (
    <span dir={text.dir} className={className}>
      {text.value}
    </span>
  );
}

function Header({ version, note }: { version: MapVersion; note: ReactNode }) {
  const block = version.settings.titleBlock;
  const lang = langForDir(version.uiDir);
  if (!block.show) {
    return (
      <header className={note ? "shrink-0 px-3 py-1.5 @md:px-4" : "sr-only"}>
        <h1 dir={version.title.dir} className="sr-only">
          {version.title.value}
        </h1>
        {note ? <p className="text-xs text-ink-3 tabular-nums">{note}</p> : null}
      </header>
    );
  }
  return (
    <header className="shrink-0 px-3 pt-2.5 pb-2 @md:px-4 @md:pt-3 @md:pb-2.5">
      <h1 dir={version.title.dir} className="text-start font-title text-lg leading-tight font-semibold text-balance text-ink @md:text-xl">
        {version.title.value}
      </h1>
      {block.subtitle ? (
        <p dir={block.subtitle.dir} className="mt-1 max-w-3xl text-start text-sm text-pretty text-ink-2">
          {block.subtitle.value}
        </p>
      ) : null}
      {block.asOf || note ? (
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-2 tabular-nums">
          {block.asOf ? (
            <time dateTime={block.asOf} className="font-semibold text-ink">
              {formatAsOf(block.asOf, lang)}
            </time>
          ) : null}
          {note ? <span className="text-ink-3">{note}</span> : null}
        </p>
      ) : null}
    </header>
  );
}

/** The basemap's required credit, as its tile source words it. Shown wherever the basemap is. */
export function BasemapAttribution({ className }: { className?: string }) {
  const t = useEmbedStrings();
  return (
    <span className={className}>
      {ATTRIBUTION.map((link) => (
        <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="me-1 underline decoration-rule-strong underline-offset-2 hover:text-ink">
          {link.text}
        </a>
      ))}
      {t.dataFrom}{" "}
      <a href={OSM.href} target="_blank" rel="noreferrer" className="underline decoration-rule-strong underline-offset-2 hover:text-ink">
        {OSM.text}
      </a>
    </span>
  );
}

function Footer({ version }: { version: MapVersion }) {
  const block = version.settings.titleBlock;
  const source = block.source ? sourceLine(block.source, langForDir(version.uiDir)) : null;
  const lines = block.show ? [source, block.credit, block.note].flatMap((line) => (line && line.value.trim() !== "" ? [line] : [])) : [];
  return (
    <footer className="flex shrink-0 flex-wrap gap-x-4 gap-y-0.5 border-t border-rule px-3 py-1.5 text-2xs text-ink-3 @md:px-4">
      {lines.map((line) => (
        <Line key={line.value} text={line} className="text-start" />
      ))}
      <BasemapAttribution className="ms-auto" />
    </footer>
  );
}

function Viewer({ version, theme, className, furniture = "full", note, handleRef, onViewport, initialViewport, highlightIds, initialTime, timeWindowMs, ...overrides }: MapViewerProps) {
  const { embed } = version.settings;
  const scope = useThemeScope(theme ?? embed.theme);
  const playback = usePlayback(version, { initialTime, windowMs: timeWindowMs });
  const isStatic = overrides.static ?? embed.static;
  const full = furniture === "full";
  const dir = version.uiDir;
  /* A picture has no controls, so it shows the whole span: the map as it stands at the end. */
  const timed = full && !isStatic && playback !== null;

  return (
    <div
      dir={dir}
      lang={langForDir(dir)}
      style={scope.style}
      className={cn("@container flex min-h-0 flex-col overflow-hidden bg-panel font-ui text-sm text-ink", scope.className, className)}
    >
      {full ? <Header version={version} note={note} /> : null}
      <MapStage
        version={version}
        scope={scope}
        navigation={isStatic ? "none" : embed.cooperativeGestures && full ? "cooperative" : "free"}
        showKey={overrides.legend ?? embed.legend}
        showZoom={overrides.zoomButtons ?? embed.zoomButtons}
        showPan={overrides.panButtons ?? embed.panButtons}
        showFullscreen={overrides.fullscreen === true}
        showScale={overrides.scaleBar ?? embed.scaleBar}
        timeWindow={timed ? playback.window : null}
        highlightIds={highlightIds ?? NO_IDS}
        initialViewport={initialViewport}
        handleRef={handleRef}
        onViewport={onViewport}
      />
      {timed ? <ReaderTimeline playback={playback} features={version.features} dir={dir} /> : null}
      {full ? <Footer version={version} /> : null}
    </div>
  );
}

/**
 * The read-only reader view of one published version: what sits in an
 * article's iframe, what the editor's preview shows and what the versions
 * screen compares. It draws through the editor's renderer, sizes its layout to
 * its own box and not to the window, and reads no storage.
 */
export function MapViewer(props: MapViewerProps) {
  return (
    <LangProvider lang={langForDir(props.version.uiDir)}>
      <Viewer {...props} />
    </LangProvider>
  );
}
