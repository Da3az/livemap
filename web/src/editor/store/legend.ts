import type { FeatureKind, LegendItem, MapFeature, MapSettings, PointFeature, RichText } from "@/model/types";
import { presetLookup, swatchOf, type Swatch } from "./style";

/** One line of the map key as it will render. */
export interface LegendEntry {
  /** Stable key for lists: `legendKey(ref)`. */
  key: string;
  ref: LegendItem["ref"];
  /** The text shown: the override, or the preset or feature name. */
  label: RichText;
  /** True when the editor typed a label of their own. */
  overridden: boolean;
  /** Hidden entries stay in the editor's list and are left out of the published key. */
  hidden: boolean;
  swatch: Swatch;
  /** How many visible features this entry stands for. */
  count: number;
}

/** A stable string for a legend reference. */
export function legendKey(ref: LegendItem["ref"]): string {
  return "presetId" in ref ? `preset:${ref.presetId}` : `feature:${ref.featureId}`;
}

interface PresetUse {
  count: number;
  kinds: Map<FeatureKind, number>;
  symbol: PointFeature["symbol"] | null;
}

function effectivelyHidden(feature: MapFeature, hiddenGroups: ReadonlySet<string>): boolean {
  return feature.hidden || (feature.groupId !== null && hiddenGroups.has(feature.groupId));
}

/**
 * The map key, derived: the stored items that still mean something, in their
 * stored order, followed by presets that are in use and not yet listed. A
 * preset is in use when a visible feature follows it. A single feature appears
 * only if the editor added it and it has no preset.
 */
export function legendEntries(settings: MapSettings, features: Iterable<MapFeature>): LegendEntry[] {
  const presets = presetLookup(settings.presets);
  const hiddenGroups = new Set(settings.groups.filter((group) => group.hidden).map((group) => group.id));
  const uses = new Map<string, PresetUse>();
  const loose = new Map<string, MapFeature>();
  const wanted = new Set<string>();
  for (const item of settings.legend.items) if ("featureId" in item.ref) wanted.add(item.ref.featureId);

  for (const feature of features) {
    if (effectivelyHidden(feature, hiddenGroups)) continue;
    const preset = feature.presetId === null ? undefined : presets.get(feature.presetId);
    if (preset !== undefined && preset.appliesTo.includes(feature.kind)) {
      const use = uses.get(preset.id) ?? { count: 0, kinds: new Map<FeatureKind, number>(), symbol: null };
      use.count += 1;
      use.kinds.set(feature.kind, (use.kinds.get(feature.kind) ?? 0) + 1);
      if (feature.kind === "point" && use.symbol === null) use.symbol = feature.symbol;
      uses.set(preset.id, use);
    } else if (wanted.has(feature.id)) {
      loose.set(feature.id, feature);
    }
  }

  const entries: LegendEntry[] = [];
  const listed = new Set<string>();
  const add = (item: LegendItem): void => {
    const key = legendKey(item.ref);
    if (listed.has(key)) return;
    if ("presetId" in item.ref) {
      const preset = presets.get(item.ref.presetId);
      const use = uses.get(item.ref.presetId);
      if (preset === undefined || use === undefined) return;
      let kind: FeatureKind = preset.appliesTo[0] ?? "area";
      let most = 0;
      for (const [candidate, count] of use.kinds) {
        if (count > most) {
          most = count;
          kind = candidate;
        }
      }
      entries.push({
        key,
        ref: item.ref,
        label: item.label ?? preset.name,
        overridden: item.label !== null,
        hidden: item.hidden,
        swatch: {
          kind,
          presetId: preset.id,
          fill: kind === "area" ? (preset.fill ?? null) : null,
          stroke: kind === "point" ? null : (preset.stroke ?? null),
          color: (kind === "point" ? preset.iconColor : preset.stroke?.color) ?? preset.fill?.color ?? null,
          symbol: kind === "point" ? use.symbol : null,
        },
        count: use.count,
      });
    } else {
      const feature = loose.get(item.ref.featureId);
      if (feature === undefined) return;
      entries.push({
        key,
        ref: item.ref,
        label: item.label ?? feature.name,
        overridden: item.label !== null,
        hidden: item.hidden,
        swatch: swatchOf(feature, presets),
        count: 1,
      });
    }
    listed.add(key);
  };

  for (const item of settings.legend.items) add(item);
  for (const preset of settings.presets) add({ ref: { presetId: preset.id }, label: null, hidden: false });
  return entries;
}

/** The derived key written back in the stored shape, so an edit to one entry fixes the order of all. */
export function materialiseLegend(settings: MapSettings, features: Iterable<MapFeature>): LegendItem[] {
  const stored = new Map(settings.legend.items.map((item) => [legendKey(item.ref), item]));
  return legendEntries(settings, features).map(
    (entry) => stored.get(entry.key) ?? { ref: entry.ref, label: null, hidden: false },
  );
}
