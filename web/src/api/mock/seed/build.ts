/**
 * Small helpers the seed maps are written with: text, style and geometry
 * shorthands, and a builder that hands out ids and draw-order keys and can
 * replay a map as it stood at an earlier publish ("step").
 */
import { keysBetween } from "@/model/order";
import type {
  AnnotationFeature,
  AreaFeature,
  ArrowFeature,
  BasemapStyleId,
  ColorRef,
  DashStyle,
  FeatureBase,
  FeatureKind,
  Fill,
  FillPattern,
  FrontlineFeature,
  IconId,
  IsoDateTime,
  LabelLanguage,
  LabelStyle,
  LegendItem,
  LineFeature,
  LngLat,
  MapFeature,
  MapSettings,
  PaletteSlot,
  PointFeature,
  RichText,
  Stroke,
  StylePreset,
} from "@/model/types";

/* ------------------------------------------------------------------ text */

export const en = (value: string): RichText => ({ value, dir: "ltr" });
export const ar = (value: string): RichText => ({ value, dir: "rtl" });

/* ----------------------------------------------------------------- style */

export const slot = (n: PaletteSlot): ColorRef => ({ slot: n });

export function fill(color: PaletteSlot, opacity = 0.28, pattern: FillPattern = "none"): Fill {
  return { color: slot(color), opacity, pattern };
}

export function stroke(color: PaletteSlot, width = 2, dash: DashStyle = "solid", opacity = 1): Stroke {
  return { color: slot(color), width, opacity, dash };
}

export const LABEL_PLAIN: LabelStyle = { color: "ink", size: 12, weight: 600, halo: true, box: false };
export const LABEL_BOXED: LabelStyle = { color: "ink", size: 12, weight: 400, halo: false, box: true };

export function preset(
  id: string,
  name: RichText,
  appliesTo: FeatureKind[],
  style: { fill?: Fill; stroke?: Stroke; iconColor?: ColorRef },
): StylePreset {
  return { id, name, appliesTo, ...style };
}

/* -------------------------------------------------------------- geometry */

const KM_PER_DEGREE_LAT = 110.574;
const round = (n: number): number => Math.round(n * 1e5) / 1e5;
const lngScale = (lat: number): number => Math.cos((lat * Math.PI) / 180);

/** The ring with its first point repeated at the end, as the model requires. */
export function closed(points: LngLat[]): LngLat[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, [first[0], first[1]]];
}

/** A ring approximating a circle of `km` radius. */
export function circle(center: LngLat, km: number, steps = 40): LngLat[] {
  const dLat = km / KM_PER_DEGREE_LAT;
  const dLng = dLat / lngScale(center[1]);
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([round(center[0] + Math.cos(angle) * dLng), round(center[1] + Math.sin(angle) * dLat)]);
  }
  return closed(ring);
}

/**
 * A ring that follows `path` at a distance on both sides. A function for the
 * half-width (given 0 at the start and 1 at the end) makes a widening cone;
 * `roundEnd` closes the far end with an arc instead of a straight edge.
 */
export function corridor(path: LngLat[], halfWidthKm: number | ((t: number) => number), roundEnd = false): LngLat[] {
  const left: LngLat[] = [];
  const right: LngLat[] = [];
  const cap: LngLat[] = [];
  path.forEach((point, i) => {
    const before = path[i - 1] ?? point;
    const after = path[i + 1] ?? point;
    const k = lngScale(point[1]);
    const dx = (after[0] - before[0]) * k;
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy) || 1;
    const t = path.length > 1 ? i / (path.length - 1) : 0;
    const width = (typeof halfWidthKm === "number" ? halfWidthKm : halfWidthKm(t)) / KM_PER_DEGREE_LAT;
    const ux = dx / length;
    const uy = dy / length;
    left.push([round(point[0] - (uy * width) / k), round(point[1] + ux * width)]);
    right.push([round(point[0] + (uy * width) / k), round(point[1] - ux * width)]);
    if (roundEnd && i === path.length - 1) {
      /* Sweep from the left edge, through straight ahead, to the right edge. */
      const steps = 10;
      for (let s = 1; s < steps; s++) {
        const angle = Math.PI / 2 - (s / steps) * Math.PI;
        const cx = ux * Math.cos(angle) - uy * Math.sin(angle);
        const cy = uy * Math.cos(angle) + ux * Math.sin(angle);
        cap.push([round(point[0] + (cx * width) / k), round(point[1] + cy * width)]);
      }
    }
  });
  return closed([...left, ...cap, ...right.reverse()]);
}

/** Every point moved by the same amount. */
export function shift(path: LngLat[], dLng: number, dLat: number): LngLat[] {
  return path.map((p): LngLat => [round(p[0] + dLng), round(p[1] + dLat)]);
}

/** A band between a line moved one way and the same line moved another. */
export function band(path: LngLat[], near: LngLat, far: LngLat): LngLat[] {
  return closed([...shift(path, near[0], near[1]), ...shift(path, far[0], far[1]).reverse()]);
}

/* -------------------------------------------------------------- settings */

export interface SettingsInput {
  center: LngLat;
  zoom: number;
  basemap?: BasemapStyleId;
  labelLanguage?: LabelLanguage;
  presets: StylePreset[];
  /** [id, name] in list order, top first */
  groups: [string, RichText][];
  legendTitle: RichText;
  /** Defaults to one item per preset, in preset order. */
  legendItems?: LegendItem[];
  legendPosition?: MapSettings["legend"]["position"];
  showLegend?: boolean;
  titleBlock?: Partial<MapSettings["titleBlock"]>;
  timeline?: Partial<MapSettings["timeline"]>;
  embed?: Partial<MapSettings["embed"]>;
}

export function makeSettings(input: SettingsInput): MapSettings {
  const groupKeys = keysBetween(null, null, input.groups.length);
  return {
    basemap: { styleId: input.basemap ?? "positron", labelLanguage: input.labelLanguage ?? "local" },
    openingView: { center: input.center, zoom: input.zoom, bearing: 0, pitch: 0 },
    presets: input.presets,
    groups: input.groups.map(([id, name], i) => ({
      id,
      name,
      order: groupKeys[i] ?? "V",
      hidden: false,
      locked: false,
      collapsed: false,
    })),
    legend: {
      show: input.showLegend ?? true,
      title: input.legendTitle,
      position: input.legendPosition ?? "bottom-start",
      items: input.legendItems ?? input.presets.map((p) => ({ ref: { presetId: p.id }, label: null, hidden: false })),
    },
    titleBlock: { show: true, subtitle: null, source: null, credit: null, note: null, asOf: null, ...input.titleBlock },
    timeline: { enabled: false, mode: "cumulative", speed: 3600, windowMs: 86_400_000, ...input.timeline },
    embed: {
      legend: true,
      zoomButtons: true,
      scaleBar: true,
      cooperativeGestures: true,
      static: false,
      theme: "auto",
      ...input.embed,
    },
  };
}

/* --------------------------------------------------------------- builder */

export interface Common {
  name: RichText;
  label?: RichText;
  labelStyle?: LabelStyle;
  group?: string;
  preset?: string;
  from?: IsoDateTime;
  to?: IsoDateTime;
  lineage?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Display name of who last touched it; defaults to the builder's. */
  by?: string;
  when?: IsoDateTime;
  /** First publish step that includes the feature (default 1). */
  since?: number;
  /** First publish step that no longer includes it. */
  until?: number;
  /** Steps it was missing from, for a version published by mistake. */
  skip?: number[];
}

export type FeaturePatch = (feature: MapFeature) => MapFeature;

interface Entry {
  feature: MapFeature;
  since: number;
  until: number;
  skip: number[];
  revisions: { step: number; patch: FeaturePatch }[];
}

/** Steps run from 1; the draft is whatever `build()` returns with no step. */
export class MapBuilder {
  private readonly prefix: string;
  private readonly presets: StylePreset[];
  private readonly defaults: { by: string; at: IsoDateTime };
  private readonly entries: Entry[] = [];

  constructor(prefix: string, presets: StylePreset[], defaults: { by: string; at: IsoDateTime }) {
    this.prefix = prefix;
    this.presets = presets;
    this.defaults = defaults;
  }

  private base(c: Common): FeatureBase {
    const id = `${this.prefix}-${String(this.entries.length + 1).padStart(3, "0")}`;
    return {
      id,
      order: "",
      name: c.name,
      ...(c.label ? { label: c.label, labelStyle: c.labelStyle ?? LABEL_PLAIN } : {}),
      groupId: c.group ?? null,
      hidden: c.hidden ?? false,
      locked: c.locked ?? false,
      presetId: c.preset ?? null,
      validFrom: c.from ?? null,
      validTo: c.to ?? null,
      lineageId: c.lineage ?? null,
      updatedAt: c.when ?? this.defaults.at,
      updatedBy: c.by ?? this.defaults.by,
    };
  }

  private add(c: Common, feature: MapFeature): string {
    this.entries.push({
      feature,
      since: c.since ?? 1,
      until: c.until ?? Number.POSITIVE_INFINITY,
      skip: c.skip ?? [],
      revisions: [],
    });
    return feature.id;
  }

  private presetOf(c: Common): StylePreset | undefined {
    return c.preset ? this.presets.find((p) => p.id === c.preset) : undefined;
  }

  area(c: Common & { ring: LngLat[]; holes?: LngLat[][]; fill?: Fill; stroke?: Stroke }): string {
    const p = this.presetOf(c);
    const feature: AreaFeature = {
      ...this.base(c),
      kind: "area",
      rings: [closed(c.ring), ...(c.holes ?? []).map(closed)],
      fill: c.fill ?? p?.fill ?? fill(2),
      stroke: c.stroke ?? p?.stroke ?? stroke(2, 1.5),
    };
    return this.add(c, feature);
  }

  line(c: Common & { path: LngLat[]; stroke?: Stroke }): string {
    const feature: LineFeature = {
      ...this.base(c),
      kind: "line",
      path: c.path,
      stroke: c.stroke ?? this.presetOf(c)?.stroke ?? stroke(2, 2.5),
    };
    return this.add(c, feature);
  }

  arrow(
    c: Common & {
      control: LngLat[];
      curvature?: number;
      head?: ArrowFeature["head"];
      tapered?: boolean;
      stroke?: Stroke;
    },
  ): string {
    const feature: ArrowFeature = {
      ...this.base(c),
      kind: "arrow",
      control: c.control,
      curvature: c.curvature ?? 0.6,
      head: c.head ?? "single",
      tapered: c.tapered ?? false,
      stroke: c.stroke ?? this.presetOf(c)?.stroke ?? stroke(2, 3),
    };
    return this.add(c, feature);
  }

  frontline(
    c: Common & {
      path: LngLat[];
      facing: FrontlineFeature["facing"];
      toothShape?: FrontlineFeature["toothShape"];
      toothSpacing?: number;
      toothSize?: number;
      stroke?: Stroke;
    },
  ): string {
    const feature: FrontlineFeature = {
      ...this.base(c),
      kind: "frontline",
      path: c.path,
      facing: c.facing,
      toothShape: c.toothShape ?? "triangle",
      toothSpacing: c.toothSpacing ?? 18,
      toothSize: c.toothSize ?? 7,
      stroke: c.stroke ?? this.presetOf(c)?.stroke ?? stroke(1, 2.5),
    };
    return this.add(c, feature);
  }

  icon(c: Common & { at: LngLat; icon: IconId; color?: PaletteSlot; size?: number }): string {
    const feature: PointFeature = {
      ...this.base(c),
      kind: "point",
      at: c.at,
      symbol: { icon: c.icon },
      color: c.color ? slot(c.color) : (this.presetOf(c)?.iconColor ?? slot(2)),
      size: c.size ?? 22,
    };
    return this.add(c, feature);
  }

  number(c: Common & { at: LngLat; number: string; color?: PaletteSlot; size?: number }): string {
    const feature: PointFeature = {
      ...this.base(c),
      kind: "point",
      at: c.at,
      symbol: { number: c.number },
      color: c.color ? slot(c.color) : (this.presetOf(c)?.iconColor ?? slot(2)),
      size: c.size ?? 24,
    };
    return this.add(c, feature);
  }

  note(
    c: Common & {
      anchor: LngLat;
      textAt: LngLat;
      text: RichText;
      leader?: "straight" | "elbow" | null;
      dot?: boolean;
      style?: LabelStyle;
    },
  ): string {
    const feature: AnnotationFeature = {
      ...this.base(c),
      kind: "annotation",
      anchor: c.anchor,
      textAt: c.textAt,
      text: c.text,
      labelStyle: c.style ?? LABEL_BOXED,
      leader: c.leader === null ? null : { shape: c.leader ?? "straight", anchorDot: c.dot ?? true },
    };
    return this.add(c, feature);
  }

  /** From publish step `step` on, the feature is whatever `patch` returns. */
  revise(id: string, step: number, patch: FeaturePatch): void {
    const entry = this.entries.find((e) => e.feature.id === id);
    if (!entry) throw new Error(`seed: no feature ${id} to revise`);
    entry.revisions.push({ step, patch });
  }

  /** The features as published at `step`, or the draft when no step is given. */
  build(step = Number.MAX_SAFE_INTEGER): MapFeature[] {
    const keys = keysBetween(null, null, this.entries.length);
    const out: MapFeature[] = [];
    this.entries.forEach((entry, i) => {
      if (step < entry.since || step >= entry.until || entry.skip.includes(step)) return;
      let feature: MapFeature = { ...entry.feature, order: keys[i] ?? "V" };
      for (const revision of entry.revisions) {
        if (step >= revision.step) feature = revision.patch(feature);
      }
      out.push(feature);
    });
    return out;
  }
}

/** Swap a feature onto another preset, taking the preset's style with it. */
export function withPreset(presets: StylePreset[], presetId: string): FeaturePatch {
  const p = presets.find((candidate) => candidate.id === presetId);
  return (feature) => {
    if (!p) return feature;
    if (feature.kind === "area") {
      return { ...feature, presetId, fill: p.fill ?? feature.fill, stroke: p.stroke ?? feature.stroke };
    }
    if (feature.kind === "point") return { ...feature, presetId, color: p.iconColor ?? feature.color };
    if (feature.kind === "annotation") return { ...feature, presetId };
    return { ...feature, presetId, stroke: p.stroke ?? feature.stroke };
  };
}
