import { sortKeyed, type Doc, type MapMeta } from "@/editor/store";
import type { MapFeature, MapSettings, MapVersion } from "@/model/types";

/** What the draft would publish, and what it would leave behind. */
export interface DraftArtifact {
  version: MapVersion;
  /** Features left out because they, or their group, are hidden. */
  leftOut: MapFeature[];
}

/**
 * The artifact the draft on screen would become, built the way the publish
 * pipeline builds it: hidden features and features in hidden groups are left
 * out, and what exists only for the editor (hidden, locked, collapsed) is
 * reset on everything that remains.
 */
export function draftArtifact(doc: Doc, meta: MapMeta, publishedAt: string): DraftArtifact {
  const hiddenGroups = new Set(doc.settings.groups.filter((group) => group.hidden).map((group) => group.id));
  const features: MapFeature[] = [];
  const leftOut: MapFeature[] = [];
  for (const feature of sortKeyed(doc.features.values())) {
    if (feature.hidden || (feature.groupId !== null && hiddenGroups.has(feature.groupId))) leftOut.push(feature);
    else features.push({ ...feature, hidden: false, locked: false });
  }
  const published = new Set(features.map((feature) => feature.id));
  const settings: MapSettings = {
    ...doc.settings,
    groups: doc.settings.groups.filter((group) => !group.hidden).map((group) => ({ ...group, hidden: false, locked: false, collapsed: false })),
    legend: {
      ...doc.settings.legend,
      items: doc.settings.legend.items.filter((item) => !("featureId" in item.ref) || published.has(item.ref.featureId)),
    },
  };
  return {
    version: {
      mapId: meta.id,
      version: (meta.publishedVersion ?? 0) + 1,
      title: doc.title,
      uiDir: doc.uiDir,
      settings,
      features,
      publishedAt,
    },
    leftOut,
  };
}
