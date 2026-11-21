import type { LngLat, MapFeature } from "@/model/types";
import { base, FIXTURE_TIME, ICONS, SLOTS } from "./fixtures";

/** A large, fixed, synthetic scene for measuring the renderer. Same sequence every run. */

const STRESS_LABELS = ["Ibri", "Nizwa", "Sur", "Rustaq", "Bahla", "Ibra", "Adam", "Samail", "Izki", "Bidiyah"] as const;

/** `labelled` gives every feature (not only points) a label, to load the label placer. */
export function stressFeatures(count: number, options: { labelled?: boolean } = {}): MapFeature[] {
  const span = Date.parse(FIXTURE_TIME.to) - Date.parse(FIXTURE_TIME.from);
  const start = Date.parse(FIXTURE_TIME.from);
  /* A fixed sequence, so two runs measure the same scene. */
  let seed = 20211003;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const features: MapFeature[] = [];
  for (let index = 0; index < count; index++) {
    const lng = 56.2 + random() * 2.6;
    const lat = 23.0 + random() * 1.8;
    const from = start + random() * span * 0.8;
    const window = { validFrom: new Date(from).toISOString(), validTo: new Date(from + span * (0.05 + random() * 0.3)).toISOString() };
    const slot = SLOTS[index % SLOTS.length] ?? 1;
    const id = `stress-${index}`;
    const order = `s${String(index).padStart(4, "0")}`;
    const vertices = (n: number, radius: number): LngLat[] =>
      Array.from({ length: n }, (_, step) => {
        const angle = (Math.PI * 2 * step) / n;
        const reach = radius * (0.7 + random() * 0.6);
        return [lng + Math.cos(angle) * reach, lat + Math.sin(angle) * reach * 0.9];
      });
    const kind = index % 5;
    if (kind === 0) {
      const ring = vertices(24, 0.09);
      const first = ring[0];
      features.push({
        ...base(id, order, `Reported flooding ${index}`, window),
        kind: "area",
        rings: [first ? [...ring, first] : ring],
        fill: { color: { slot }, opacity: 0.35, pattern: index % 3 === 0 ? "hatch" : "none" },
        stroke: { color: { slot }, width: 1.5, opacity: 1, dash: "solid" },
      });
    } else if (kind === 1) {
      features.push({
        ...base(id, order, `Closed road ${index}`, window),
        kind: "line",
        path: vertices(12, 0.12).slice(0, 8),
        stroke: { color: { slot }, width: 2.5, opacity: 1, dash: index % 2 === 0 ? "dashed" : "solid" },
      });
    } else if (kind === 2) {
      features.push({
        ...base(id, order, `Movement ${index}`, window),
        kind: "arrow",
        control: vertices(6, 0.1).slice(0, 3),
        curvature: 1,
        head: "single",
        tapered: false,
        stroke: { color: { slot }, width: 3, opacity: 1, dash: "solid" },
      });
    } else if (kind === 3) {
      features.push({
        ...base(id, order, `Front ${index}`, window),
        kind: "frontline",
        path: vertices(10, 0.12).slice(0, 5),
        facing: "left",
        toothShape: "triangle",
        toothSpacing: 20,
        toothSize: 8,
        stroke: { color: { slot }, width: 2, opacity: 1, dash: "solid" },
      });
    } else {
      features.push({
        ...base(id, order, `Report ${index}`, window),
        kind: "point",
        at: [lng, lat],
        symbol: index % 2 === 0 ? { icon: ICONS[index % ICONS.length] ?? "pin" } : { number: String(index % 100) },
        color: { slot },
        size: 22,
        label: { value: `Report ${index}`, dir: "ltr" },
        labelStyle: { color: "ink", size: 11, weight: 400, halo: true, box: false },
      });
    }
  }
  if (!options.labelled) return features;
  return features.map((feature, index) =>
    feature.kind === "annotation" || feature.label
      ? feature
      : { ...feature, label: { value: `${STRESS_LABELS[index % STRESS_LABELS.length] ?? "Sur"} ${index}`, dir: "ltr" }, labelStyle: { color: "ink", size: 11, weight: 400, halo: true, box: false } },
  );
}
