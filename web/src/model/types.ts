/**
 * The domain model lives in @livemap/core, shared with the API. This path
 * stays for the front end's imports.
 *
 * One type differs on this side. A published artifact leaves out who changed
 * each feature and when (see `PublishedFeature`); the front end's
 * `MapVersion` carries whole features, because the drawing, legend and diff
 * code all take `MapFeature`. The API client converts at the boundary with
 * `fromArtifact` (model/published.ts), so nothing past it sees the difference.
 */
import type { MapFeature, MapVersion as ArtifactVersion } from "@livemap/core";

export type * from "@livemap/core";

export type MapVersion = Omit<ArtifactVersion, "features"> & { features: MapFeature[] };
