import type { FeatureGroup, FeatureKind, IsoDateTime, MapFeature, RichText } from "@/model/types";
import type { Doc } from "./doc";
import { sortKeyed } from "./ordering";
import { memoLast, selectPresetLookup } from "./selectors";
import type { EditorState, Selection } from "./state";
import { resolveStyle, type PresetLookup } from "./style";
import { readStyle, type StyleProperty, type StyleValues } from "./style-properties";

/* ------------------------------------------------------ selection summary */

/**
 * One property across a selection: `none` when no selected feature has it,
 * `value` when all that have it agree, `mixed` when they differ.
 */
export type Mixed<T> = { state: "none" } | { state: "value"; value: T } | { state: "mixed" };

/** What the inspector shows for the current selection. */
export interface SelectionSummary {
  count: number;
  ids: readonly string[];
  /** Selected features in draw order, bottom first. */
  features: MapFeature[];
  /** The one selected feature, when exactly one is. */
  single: MapFeature | null;
  /** The selected group row, when one is. */
  group: FeatureGroup | null;
  /** The kinds present, in a fixed order. */
  kinds: FeatureKind[];
  /** True when a lock covers at least one selected feature; such features are skipped by edits. */
  anyLocked: boolean;
  /** True when a lock covers all of them; edits would be refused. */
  allLocked: boolean;
  /** Every style property, by the names `restyle` takes. */
  style: { [K in StyleProperty]: Mixed<StyleValues[K]> };
  name: Mixed<RichText>;
  presetId: Mixed<string | null>;
  groupId: Mixed<string | null>;
  hidden: Mixed<boolean>;
  locked: Mixed<boolean>;
  validFrom: Mixed<IsoDateTime | null>;
  validTo: Mixed<IsoDateTime | null>;
  lineageId: Mixed<string | null>;
}

const KIND_ORDER: FeatureKind[] = ["area", "line", "arrow", "frontline", "point", "annotation"];

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function mix<T>(values: Iterable<T | undefined>): Mixed<T> {
  let first: { value: T } | null = null;
  for (const value of values) {
    if (value === undefined) continue;
    if (first === null) first = { value };
    else if (!same(first.value, value)) return { state: "mixed" };
  }
  return first === null ? { state: "none" } : { state: "value", value: first.value };
}

const selectionSummary = memoLast(
  (
    features: Doc["features"],
    selection: Selection,
    groups: readonly FeatureGroup[],
    presets: PresetLookup,
  ): SelectionSummary => {
    const selected = sortKeyed(
      selection.ids.map((id) => features.get(id)).filter((feature) => feature !== undefined),
    );
    const lockedGroupIds = new Set(groups.filter((group) => group.locked).map((group) => group.id));
    const covered = selected.filter(
      (feature) => feature.locked || (feature.groupId !== null && lockedGroupIds.has(feature.groupId)),
    );
    const kinds = new Set(selected.map((feature) => feature.kind));
    const style = <K extends StyleProperty>(property: K): Mixed<StyleValues[K]> =>
      mix(selected.map((feature) => readStyle(feature, property, presets)));
    const field = <T>(pick: (feature: MapFeature) => T): Mixed<T> => mix(selected.map(pick));
    return {
      count: selected.length,
      ids: selection.ids,
      features: selected,
      single: selected.length === 1 ? (selected[0] ?? null) : null,
      group: selection.groupId === null ? null : (groups.find((group) => group.id === selection.groupId) ?? null),
      kinds: KIND_ORDER.filter((kind) => kinds.has(kind)),
      anyLocked: covered.length > 0,
      allLocked: selected.length > 0 && covered.length === selected.length,
      style: {
        color: style("color"),
        "fill.color": style("fill.color"),
        "fill.opacity": style("fill.opacity"),
        "fill.pattern": style("fill.pattern"),
        "stroke.color": style("stroke.color"),
        "stroke.width": style("stroke.width"),
        "stroke.opacity": style("stroke.opacity"),
        "stroke.dash": style("stroke.dash"),
        label: style("label"),
        "labelStyle.color": style("labelStyle.color"),
        "labelStyle.size": style("labelStyle.size"),
        "labelStyle.weight": style("labelStyle.weight"),
        "labelStyle.halo": style("labelStyle.halo"),
        "labelStyle.box": style("labelStyle.box"),
        "point.symbol": style("point.symbol"),
        "point.size": style("point.size"),
        "annotation.text": style("annotation.text"),
        "annotation.leader": style("annotation.leader"),
        "arrow.curvature": style("arrow.curvature"),
        "arrow.bend": style("arrow.bend"),
        "arrow.head": style("arrow.head"),
        "arrow.tapered": style("arrow.tapered"),
        "frontline.facing": style("frontline.facing"),
        "frontline.toothShape": style("frontline.toothShape"),
        "frontline.toothSpacing": style("frontline.toothSpacing"),
        "frontline.toothSize": style("frontline.toothSize"),
      },
      name: field((feature) => feature.name),
      presetId: field((feature) => resolveStyle(feature, presets).presetId),
      groupId: field((feature) => feature.groupId),
      hidden: field((feature) => feature.hidden),
      locked: field((feature) => feature.locked),
      validFrom: field((feature) => feature.validFrom),
      validTo: field((feature) => feature.validTo),
      lineageId: field((feature) => feature.lineageId),
    };
  },
);

/** Common values and "mixed" markers across the selection, per property. */
export function selectSelectionSummary(state: EditorState): SelectionSummary {
  return selectionSummary(state.doc.features, state.selection, state.doc.settings.groups, selectPresetLookup(state));
}

const selectedSet = memoLast((ids: readonly string[]): ReadonlySet<string> => new Set(ids));

/** The selected ids as a set, for `has` checks in list rows. */
export function selectSelectedSet(state: EditorState): ReadonlySet<string> {
  return selectedSet(state.selection.ids);
}
