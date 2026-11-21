import { buildFeature, initialDrawDefaults, type NewGeometry } from "@/editor/store";
import type { FeatureKind, MapFeature, StylePreset } from "@/model/types";

type StyledKind = Exclude<FeatureKind, "annotation">;

const GEOMETRY: Record<StyledKind, NewGeometry> = {
  area: { kind: "area", rings: [] },
  line: { kind: "line", path: [] },
  arrow: { kind: "arrow", control: [] },
  frontline: { kind: "frontline", path: [] },
  point: { kind: "point", at: [0, 0] },
};

const ORDER: StyledKind[] = ["area", "line", "frontline", "arrow", "point"];

/** The kind that shows a preset best: an area when it has a fill, a line for a stroke alone, an icon otherwise. */
export function showcaseKind(preset: StylePreset): StyledKind {
  return ORDER.find((kind) => preset.appliesTo.includes(kind)) ?? "area";
}

/**
 * A feature the swatch painter can draw for a preset: one that really uses
 * it when there is one, so the swatch shows the kind the map shows, and a
 * stand-in otherwise.
 */
export function sampleForPreset(preset: StylePreset, features: Iterable<MapFeature>): MapFeature {
  for (const feature of features) {
    if (feature.presetId === preset.id && preset.appliesTo.includes(feature.kind) && !feature.hidden) return feature;
  }
  const stand = buildFeature(GEOMETRY[showcaseKind(preset)], initialDrawDefaults(), {
    uiDir: "ltr",
    now: "",
    userId: "",
    id: `sample:${preset.id}`,
  });
  return { ...stand, presetId: preset.id };
}

/** How many features follow each preset. */
export function presetUse(features: Iterable<MapFeature>): Map<string, number> {
  const use = new Map<string, number>();
  for (const feature of features) {
    if (feature.presetId !== null) use.set(feature.presetId, (use.get(feature.presetId) ?? 0) + 1);
  }
  return use;
}
