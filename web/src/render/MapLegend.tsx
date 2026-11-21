import { useMemo, useRef } from "react";
import type { MapFeature, MapSettings } from "@/model/types";
import { legendEntries } from "./furniture";
import { FeatureSwatch } from "./FeatureSwatch";
import type { ThemeMode } from "./palette";
import { usePalette } from "./use-palette";

/**
 * The map key: one row per preset in use, each with a swatch painted by the
 * map's own drawing code, so the key shows the actual fill, pattern, dash or
 * icon. Printed-looking and hard-edged; mirrors with `dir`.
 */
export function MapLegend({
  settings,
  features,
  theme,
  dir,
}: {
  settings: MapSettings;
  features: readonly MapFeature[];
  theme: ThemeMode;
  dir: "ltr" | "rtl";
}) {
  const root = useRef<HTMLElement>(null);
  const palette = usePalette(root, theme);
  const entries = useMemo(() => legendEntries(settings, features), [settings, features]);
  if (!settings.legend.show || entries.length === 0) return null;
  const { title } = settings.legend;

  return (
    <section ref={root} dir={dir} className="max-w-72 rounded-key border border-rule-strong bg-panel px-3 py-2.5 text-ink">
      {title.value.trim() !== "" && (
        <h2 dir={title.dir} className="mb-1.5 text-start font-title text-base font-semibold">
          {title.value}
        </h2>
      )}
      <ul className="flex flex-col gap-1.5">
        {entries.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2 font-ui text-sm">
            <FeatureSwatch sample={entry.sample} settings={settings} palette={palette} dir={dir} />
            <span dir={entry.label.dir} className="min-w-0 text-start">
              {entry.label.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
