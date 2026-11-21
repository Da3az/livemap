import { useState } from "react";
import { Icon } from "@/components/icons";
import { useEmbedStrings } from "@/i18n/embed";
import type { MapVersion } from "@/model/types";
import { basemapTheme } from "@/render/basemap";
import { MapLegend } from "@/render/MapLegend";
import type { ThemeScope } from "./theme-scope";

type Corner = MapVersion["settings"]["legend"]["position"];

const CORNER: Record<Corner, string> = {
  "top-start": "top-2 start-2 items-start",
  "top-end": "top-2 end-2 items-end",
  "bottom-start": "bottom-2 start-2 items-start flex-col-reverse",
  "bottom-end": "bottom-2 end-2 items-end flex-col-reverse",
};

/**
 * The map key in the corner its author chose. Where it would crowd the map
 * it folds to its own heading, set in the same serif, and opens in place.
 */
export function MapKey({ version, scope, folds }: { version: MapVersion; scope: ThemeScope; folds: boolean }) {
  const t = useEmbedStrings();
  const [open, setOpen] = useState(false);
  const { settings, features, uiDir: dir } = version;
  const corner = settings.legend.position;
  const title = settings.legend.title.value.trim() !== "" ? settings.legend.title : { value: t.key, dir };

  return (
    <div data-label-obstacle className={`pointer-events-none absolute flex max-h-full max-w-full flex-col gap-1 ${CORNER[corner]}`}>
      {folds ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? undefined : t.showKey}
          onClick={() => setOpen((current) => !current)}
          className="pointer-events-auto inline-flex h-dock shrink-0 items-center gap-1.5 rounded-key border border-rule-strong bg-panel px-2.5 text-ink hover:bg-well"
        >
          {open ? (
            <>
              <Icon name="close" size={12} />
              <span className="font-ui text-xs font-medium">{t.hideKey}</span>
            </>
          ) : (
            <>
              <span dir={title.dir} className="font-title text-base font-semibold">
                {title.value}
              </span>
              <Icon name="chevron" size={12} className={corner.startsWith("top") ? "rotate-90" : "-rotate-90"} />
            </>
          )}
        </button>
      ) : null}
      <div className={`pointer-events-auto min-h-0 overflow-y-auto ${open || !folds ? "block" : "hidden"}`}>
        <MapLegend key={scope.key} settings={settings} features={features} theme={basemapTheme(settings.basemap.styleId, scope.mode)} dir={dir} />
      </div>
    </div>
  );
}
