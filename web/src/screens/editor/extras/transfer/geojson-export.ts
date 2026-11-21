import { exportGeoJson, selectDrawOrder, type EditorState } from "@/editor/store";
import { downloadBlob } from "../shared/format";

export type GeoJsonScope = "all" | "selection";

export interface GeoJsonFile {
  blob: Blob;
  fileName: string;
  /** Features written to the file. */
  count: number;
}

/**
 * The map, or the selection, as a GeoJSON file. Hidden features are left out
 * of a whole-map export unless asked for, matching what is published; a
 * selection is exported as selected.
 */
export function geoJsonFile(state: EditorState, scope: GeoJsonScope, includeHidden: boolean): GeoJsonFile {
  const selected = new Set(state.selection.ids);
  const all = selectDrawOrder(state);
  const features = scope === "selection" ? all.filter((feature) => selected.has(feature.id)) : all;
  const collection = exportGeoJson(features, {
    presets: state.doc.settings.presets,
    includeHidden: scope === "selection" ? true : includeHidden,
    hiddenGroupIds: new Set(state.doc.settings.groups.filter((group) => group.hidden).map((group) => group.id)),
  });
  const suffix = scope === "selection" ? "-selection" : "";
  return {
    blob: new Blob([JSON.stringify(collection, null, 2)], { type: "application/geo+json" }),
    fileName: `${state.meta.slug}${suffix}.geojson`,
    count: collection.features.length,
  };
}

export function downloadGeoJson(state: EditorState, scope: GeoJsonScope, includeHidden: boolean): GeoJsonFile {
  const file = geoJsonFile(state, scope, includeHidden);
  downloadBlob(file.blob, file.fileName);
  return file;
}
