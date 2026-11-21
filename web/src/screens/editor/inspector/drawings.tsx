import { useEffect, useId, useRef } from "react";
import type { DashStyle, FillPattern, IconId, MapFeature, MapSettings } from "@/model/types";
import { ICON_GLYPHS, ICON_GRID, ICON_STROKE } from "@/render/icons";
import { PatternCache } from "@/render/patterns";
import { dashArray } from "@/render/style";
import { paintSwatch, SWATCH_HEIGHT, SWATCH_WIDTH } from "@/render/swatch";
import { onFontsLoaded } from "@/render/text";
import { useMapPalette } from "../shared/palette";

/**
 * The small drawings the inspector's choices are made of. Each shows what the
 * option does on the map, drawn with the same numbers the renderer uses.
 */

const patterns = new PatternCache();

/** A style as the map draws it: the legend's swatch painter on a small canvas. */
export function StyleSwatch({ sample, settings, dir }: { sample: MapFeature; settings: MapSettings; dir: "ltr" | "rtl" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const palette = useMapPalette();

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !palette) return undefined;
    const paint = (): void => {
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(SWATCH_WIDTH * pixelRatio);
      canvas.height = Math.round(SWATCH_HEIGHT * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, SWATCH_WIDTH, SWATCH_HEIGHT);
      paintSwatch(context, sample, settings, palette, patterns, {
        box: { minX: 0, minY: 0, maxX: SWATCH_WIDTH, maxY: SWATCH_HEIGHT },
        pixelRatio,
        forward: dir === "rtl" ? -1 : 1,
      });
    };
    paint();
    return onFontsLoaded(paint);
  }, [sample, settings, palette, dir]);

  return <canvas ref={ref} aria-hidden="true" className="h-4.5 w-7.5 shrink-0" />;
}

/** A fill pattern tile in the fill's own colour. */
export function PatternDraw({ pattern, color }: { pattern: FillPattern; color: string }) {
  const id = useId();
  return (
    <svg width="34" height="18" viewBox="0 0 34 18" style={{ color }}>
      <defs>
        <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
          {pattern === "hatch" || pattern === "cross" ? <path d="M-2 10L10 -2M-2 2L2 -2M6 10L10 6" stroke="currentColor" strokeWidth="1.4" /> : null}
          {pattern === "cross" ? <path d="M-2 -2L10 10M6 -2L10 2M-2 6L2 10" stroke="currentColor" strokeWidth="1.4" /> : null}
          {pattern === "dots" ? (
            <>
              <circle cx="2" cy="2" r="1.15" fill="currentColor" />
              <circle cx="6" cy="6" r="1.15" fill="currentColor" />
            </>
          ) : null}
        </pattern>
      </defs>
      <rect x="0.75" y="0.75" width="32.5" height="16.5" fill="currentColor" fillOpacity={pattern === "none" ? 0.35 : 0.12} />
      {pattern === "none" ? null : <rect x="0.75" y="0.75" width="32.5" height="16.5" fill={`url(#${id})`} />}
      <rect x="0.75" y="0.75" width="32.5" height="16.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** A line sample with the renderer's own dash lengths. */
export function DashDraw({ dash, color, width = 2 }: { dash: DashStyle; color: string; width?: number }) {
  const lengths = dashArray(dash, width);
  return (
    <svg width="40" height="10" viewBox="0 0 40 10" style={{ color }}>
      <path
        d="M2 5H38"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap={dash === "dotted" ? "round" : "butt"}
        strokeDasharray={lengths.length > 0 ? lengths.join(" ") : undefined}
      />
    </svg>
  );
}

/** An arrow with no head, one, or one at each end. Mirrors with the interface so it points the way the eye reads. */
export function HeadDraw({ head }: { head: "none" | "single" | "double" }) {
  return (
    <svg width="40" height="14" viewBox="0 0 40 14" className="rtl:-scale-x-100">
      <path d={`M${head === "double" ? 9 : 3} 7H${head === "none" ? 37 : 31}`} stroke="currentColor" strokeWidth="2.4" strokeLinecap="butt" />
      {head !== "none" ? <path d="M38 7L30 2.5V11.5z" /> : null}
      {head === "double" ? <path d="M2 7L10 2.5V11.5z" /> : null}
    </svg>
  );
}

/** A stretch of front line with its teeth. `side` puts them above or below the line. */
export function ToothDraw({ shape, side }: { shape: "triangle" | "semicircle"; side: "up" | "down" }) {
  const tooth = (x: number): string => (shape === "triangle" ? `M${x - 4} 8L${x} 2.5L${x + 4} 8z` : `M${x - 4} 8A4 4 0 0 1 ${x + 4} 8z`);
  return (
    <svg width="40" height="16" viewBox="0 0 40 16" className={side === "down" ? "-scale-y-100" : undefined}>
      <path d="M2 8.5H38" stroke="currentColor" strokeWidth="2" />
      <path d={`${tooth(9)}${tooth(20)}${tooth(31)}`} />
    </svg>
  );
}

/** Text with its leader line: none, straight to the anchor, or with one bend. */
export function LeaderDraw({ leader }: { leader: "none" | "straight" | "elbow" }) {
  return (
    <svg width="40" height="18" viewBox="0 0 40 18" className="rtl:-scale-x-100">
      <rect x="20" y="1.5" width="18" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {leader === "straight" ? <path d="M20 8L5 15" stroke="currentColor" strokeWidth="1.3" fill="none" /> : null}
      {leader === "elbow" ? <path d="M20 5H10L5 15" stroke="currentColor" strokeWidth="1.3" fill="none" /> : null}
      {leader !== "none" ? <circle cx="5" cy="15" r="2" /> : null}
    </svg>
  );
}

/** What sits behind text on the map: nothing, a halo in the land colour, or a filled box. */
export function BackingDraw({ backing }: { backing: "none" | "halo" | "box" }) {
  return (
    <span
      className={
        backing === "box"
          ? "rounded-key border border-rule-strong bg-panel px-1.5 text-xs font-semibold text-ink"
          : "px-1.5 text-xs font-semibold text-ink"
      }
      style={backing === "halo" ? { WebkitTextStroke: "3px var(--rule)", paintOrder: "stroke fill" } : undefined}
    >
      Aa
    </span>
  );
}

/** One of the twelve event icons, from the renderer's own glyph paths, on the disc the map puts it on. */
export function GlyphDraw({ icon, color, ink, size = 22 }: { icon: IconId; color: string; ink: string; size?: number }) {
  const glyph = ICON_GLYPHS[icon];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${ICON_GRID} ${ICON_GRID}`}>
      <circle cx={ICON_GRID / 2} cy={ICON_GRID / 2} r={ICON_GRID / 2 - 1} fill={color} />
      {glyph.fill ? <path d={glyph.fill} fill={ink} fillRule="evenodd" /> : null}
      {glyph.stroke ? <path d={glyph.stroke} fill="none" stroke={ink} strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}
