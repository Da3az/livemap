import { scaleBar, langForDir } from "./furniture";
import { FURNITURE_STRINGS } from "./strings";

/**
 * A scale bar for the embed and the preview. The host passes the map's
 * resolution (the controller's `getResolution()`); the bar picks the longest
 * round distance that fits and labels it.
 */
export function ScaleBar({ metresPerPixel, dir, units = "metric" }: { metresPerPixel: number; dir: "ltr" | "rtl"; units?: "metric" | "imperial" }) {
  const lang = langForDir(dir);
  const model = scaleBar(metresPerPixel, lang, { units });
  if (!model) return null;
  return (
    <div
      dir={dir}
      role="img"
      aria-label={`${FURNITURE_STRINGS[lang].scale}: ${model.label}`}
      className="inline-flex flex-col items-start gap-0.5 rounded-key border border-rule-strong bg-panel px-1.5 pt-1 pb-1.5 font-ui text-2xs font-medium text-ink tabular-nums"
    >
      <span>{model.label}</span>
      <svg width={model.width} height={6} aria-hidden="true" className="block overflow-visible text-ink">
        <path d={`M0.75 0V5.25H${model.width - 0.75}V0`} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
