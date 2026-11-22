import { buildArtifact } from "@livemap/core";
import { sortKeyed, type Doc, type MapMeta } from "@/editor/store";
import { fromArtifact } from "@/model/published";
import type { MapFeature, MapVersion } from "@/model/types";

/** What the draft would publish, and what it would leave behind. */
export interface DraftArtifact {
  version: MapVersion;
  /** Features left out because they, or their group, are hidden. */
  leftOut: MapFeature[];
}

/**
 * The artifact the draft on screen would become, built by the very function
 * the server publishes with, so the preview cannot disagree with the result.
 */
export function draftArtifact(doc: Doc, meta: MapMeta, publishedAt: string): DraftArtifact {
  const features = sortKeyed(doc.features.values());
  const artifact = buildArtifact(
    { mapId: meta.id, title: doc.title, uiDir: doc.uiDir, settings: doc.settings, features },
    (meta.publishedVersion ?? 0) + 1,
    publishedAt,
  );
  const published = new Set(artifact.features.map((feature) => feature.id));
  return { version: fromArtifact(artifact), leftOut: features.filter((feature) => !published.has(feature.id)) };
}
