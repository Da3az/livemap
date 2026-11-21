import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { formatAbsolute } from "@/components/time";
import { allCoordinates } from "@/editor/engine/edit";
import type { ChangedFeature, FeatureAspect } from "@/editor/store/diff";
import { useVersionsStrings } from "@/i18n/versions";
import type { LngLat, MapFeature, MapSettings, RichText } from "@/model/types";
import { FeatureSwatch } from "@/render/FeatureSwatch";
import { geodesicLength, lngLatToMerc } from "@/render/geo";
import type { Palette } from "@/render/palette";

/** What a diff row needs to draw a feature the way each version drew it. */
export interface Looks {
  before: MapSettings;
  after: MapSettings;
  palette: Palette | null;
  dir: "ltr" | "rtl";
}

const OUTLINE_WIDTH = 72;
const OUTLINE_HEIGHT = 40;
const OUTLINE_PAD = 4;

function centroid(points: readonly LngLat[]): LngLat | null {
  if (points.length === 0) return null;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of points) {
    lng += x;
    lat += y;
  }
  return [lng / points.length, lat / points.length];
}

function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** How far a feature's middle moved and how many points it gained or lost, in a few words. */
export function shapeSummary(before: MapFeature, after: MapFeature): string {
  const was = allCoordinates(before);
  const now = allCoordinates(after);
  const a = centroid(was);
  const b = centroid(now);
  const moved = a && b ? geodesicLength([a, b]) : 0;
  const points = now.length - was.length;
  const parts: string[] = [];
  if (moved >= 1) parts.push(`moved ${formatDistance(moved)}`);
  if (points !== 0) parts.push(`${points > 0 ? "+" : "−"}${Math.abs(points)} ${Math.abs(points) === 1 ? "point" : "points"}`);
  if (parts.length === 0) parts.push("reshaped in place");
  return parts.join(" · ");
}

function pathData(parts: readonly (readonly LngLat[])[], project: (at: LngLat) => { x: number; y: number }, closed: boolean): string {
  return parts
    .map((part) => {
      const points = part.map(project);
      if (points.length === 1) {
        const [only] = points;
        return only ? `M${only.x - 2.5},${only.y}a2.5,2.5 0 1,0 5,0a2.5,2.5 0 1,0 -5,0` : "";
      }
      return points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("") + (closed ? "Z" : "");
    })
    .join("");
}

function partsOf(feature: MapFeature): LngLat[][] {
  switch (feature.kind) {
    case "area":
      return feature.rings;
    case "line":
    case "frontline":
      return [feature.path];
    case "arrow":
      return [feature.control];
    case "point":
      return [[feature.at]];
    case "annotation":
      return [[feature.anchor]];
  }
}

/** Both outlines in one small box at one scale: the old one dashed and faint, the new one solid. */
function OutlinePair({ before, after, label }: { before: MapFeature; after: MapFeature; label: string }) {
  const all = [...allCoordinates(before), ...allCoordinates(after)].map(lngLatToMerc);
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const span = Math.max(maxX - minX, (maxY - minY) * (OUTLINE_WIDTH / OUTLINE_HEIGHT), 1e-12);
  const scale = (OUTLINE_WIDTH - OUTLINE_PAD * 2) / span;
  const offsetX = (OUTLINE_WIDTH - (maxX - minX) * scale) / 2;
  const offsetY = (OUTLINE_HEIGHT - (maxY - minY) * scale) / 2;
  const project = (at: LngLat) => {
    const p = lngLatToMerc(at);
    return { x: offsetX + (p.x - minX) * scale, y: offsetY + (p.y - minY) * scale };
  };
  const closed = after.kind === "area";
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${OUTLINE_WIDTH} ${OUTLINE_HEIGHT}`} className="h-10 w-18 shrink-0 rounded-key border border-rule bg-well">
      <path d={pathData(partsOf(before), project, before.kind === "area")} className="fill-none stroke-ink-3" strokeWidth={1.25} strokeDasharray="3 2" />
      <path d={pathData(partsOf(after), project, closed)} className={`stroke-plum ${closed ? "fill-plum/15" : "fill-none"}`} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** The text a reader or the list shows that changed: the label first, then an annotation's text, then the list name. */
function textPair(before: MapFeature, after: MapFeature): { what: string; was: RichText | null; now: RichText | null } {
  const label = (feature: MapFeature) => (feature.kind === "annotation" ? feature.text : (feature.label ?? null));
  const was = label(before);
  const now = label(after);
  if ((was?.value ?? "") !== (now?.value ?? "") || was?.dir !== now?.dir) return { what: after.kind === "annotation" ? "Text" : "Label on the map", was, now };
  return { what: "Name in the list", was: before.name, now: after.name };
}

function range(feature: MapFeature): string {
  const from = feature.validFrom ? formatAbsolute(feature.validFrom, "en") : "always";
  const to = feature.validTo ? formatAbsolute(feature.validTo, "en") : "open";
  return `${from} – ${to}`;
}

function groupName(id: string | null, settings: MapSettings): RichText | null {
  return id === null ? null : (settings.groups.find((group) => group.id === id)?.name ?? null);
}

function Words({ text }: { text: RichText | null }) {
  const t = useVersionsStrings();
  if (!text || text.value.trim() === "") return <span className="text-ink-3 italic">{t.noText}</span>;
  return <bdi dir={text.dir}>{text.value}</bdi>;
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-x-2 py-0.5">
      <dt className="w-12 shrink-0 text-2xs text-ink-3">{name}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-2">{children}</dd>
    </div>
  );
}

function Then() {
  return <Icon name="chevron" size={12} className="shrink-0 text-ink-3 rtl:rotate-180" />;
}

/** One line per changed aspect, each showing the change itself rather than naming it. */
export function ChangeDetail({ entry, looks }: { entry: ChangedFeature; looks: Looks }) {
  const { before, after } = entry;
  const lines: Partial<Record<FeatureAspect, ReactNode>> = {
    geometry: (
      <Row name="Shape">
        <OutlinePair before={before} after={after} label={`Old outline dashed, new outline solid: ${shapeSummary(before, after)}`} />
        <span className="tabular-nums">{shapeSummary(before, after)}</span>
      </Row>
    ),
    style: (
      <Row name="Style">
        <FeatureSwatch sample={before} settings={looks.before} palette={looks.palette} dir={looks.dir} label="Before" />
        <Then />
        <FeatureSwatch sample={after} settings={looks.after} palette={looks.palette} dir={looks.dir} label="After" />
      </Row>
    ),
    text: (() => {
      const pair = textPair(before, after);
      return (
        <Row name={pair.what === "Name in the list" ? "Name" : pair.what === "Text" ? "Text" : "Label"}>
          <s className="text-ink-3 decoration-ink-3">
            <Words text={pair.was} />
          </s>
          <Then />
          <span className="text-ink">
            <Words text={pair.now} />
          </span>
        </Row>
      );
    })(),
    dates: (
      <Row name="Dates">
        <s className="text-ink-3 tabular-nums decoration-ink-3">{range(before)}</s>
        <Then />
        <span className="text-ink tabular-nums">{range(after)}</span>
      </Row>
    ),
    order: <Row name="Order">{after.order > before.order ? "Drawn higher, over more of the map" : "Drawn lower, under more of the map"}</Row>,
    group: (
      <Row name="Group">
        <s className="text-ink-3 decoration-ink-3">
          <Words text={groupName(before.groupId, looks.before)} />
        </s>
        <Then />
        <span className="text-ink">
          <Words text={groupName(after.groupId, looks.after)} />
        </span>
      </Row>
    ),
  };
  return <dl className="mt-1">{entry.aspects.map((aspect) => <div key={aspect}>{lines[aspect]}</div>)}</dl>;
}
