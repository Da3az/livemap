/**
 * The people of the seeded member workspace, and the shape every seed map
 * module returns.
 */
import type { IsoDateTime, MapFeature, MapSettings, RichText, Role, TextDir } from "@/model/types";

export interface Person {
  userId: string;
  name: string;
  role: Role;
}

export const PEOPLE = {
  layla: { userId: "u_layla", name: "Layla Haddad", role: "owner" },
  sarah: { userId: "u_sarah", name: "Sarah Whitfield", role: "admin" },
  omar: { userId: "u_omar", name: "عمر الفارسي", role: "editor" },
  daniel: { userId: "u_daniel", name: "Daniel Okafor", role: "editor" },
  maryam: { userId: "u_maryam", name: "مريم البلوشي", role: "editor" },
  youssef: { userId: "u_youssef", name: "يوسف بن عمر", role: "contributor" },
  hannah: { userId: "u_hannah", name: "Hannah Lindqvist", role: "viewer" },
} as const satisfies Record<string, Person>;

export type PersonId = keyof typeof PEOPLE;

export const MEMBER_TENANT = {
  id: "t_almashriq",
  slug: "al-mashriq",
  name: "Al Mashriq Newsroom",
} as const;

/** Times in the seed are written relative to the moment the seed was built. */
export interface SeedClock {
  now: number;
  /** An ISO time `days`, `hours` and `minutes` before now. */
  ago(days: number, hours?: number, minutes?: number): IsoDateTime;
}

export function makeClock(now: number): SeedClock {
  return {
    now,
    ago: (days, hours = 0, minutes = 0) =>
      new Date(now - ((days * 24 + hours) * 60 + minutes) * 60_000).toISOString(),
  };
}

export type SeedVersion =
  | { kind: "publish"; step: number; at: IsoDateTime; by: PersonId; rev: number }
  | { kind: "rollback"; toVersion: number; at: IsoDateTime; by: PersonId };

export interface SeedMap {
  id: string;
  slug: string;
  title: RichText;
  uiDir: Exclude<TextDir, "auto">;
  createdBy: PersonId;
  archived?: boolean;
  settings: MapSettings;
  /** The draft as it stands now. */
  draft: MapFeature[];
  rev: number;
  updated: { at: IsoDateTime; by: PersonId };
  /** Oldest first; version numbers are positions in this list, from 1. */
  versions: SeedVersion[];
  /** The features as they stood at a publish step. */
  snapshot(step: number): MapFeature[];
}
