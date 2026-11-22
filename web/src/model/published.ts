import type { MapFeature, MapVersion as Artifact, PublishedFeature } from "@livemap/core";
import type { MapVersion } from "./types";

/**
 * A published artifact in the front end's shape. Artifacts leave out who
 * changed a feature and when; nothing that reads a version uses either, so
 * they are filled with the publish time and an empty author.
 */
export function fromArtifact(artifact: Artifact): MapVersion {
  const fill = (feature: PublishedFeature): MapFeature => ({ ...feature, updatedAt: artifact.publishedAt, updatedBy: "" }) as MapFeature;
  return { ...artifact, features: artifact.features.map(fill) };
}
