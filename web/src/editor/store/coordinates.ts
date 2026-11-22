import type { LngLat } from "@/model/types";

/** Coordinates as text for the status bar and for copying: "23.85000, 57.44000" (latitude first). */
export function formatCoordinates(at: LngLat, digits = 5): string {
  return `${at[1].toFixed(digits)}, ${at[0].toFixed(digits)}`;
}
