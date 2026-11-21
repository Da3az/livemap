import { useEffect, useRef } from "react";
import type { MapFeature, MapSettings } from "@/model/types";
import type { Palette } from "./palette";
import { PatternCache } from "./patterns";
import { paintSwatch, SWATCH_HEIGHT, SWATCH_WIDTH } from "./swatch";
import { onFontsLoaded } from "./text";

const patterns = new PatternCache();

/**
 * A feature's look in a 30 × 18 chip, painted by the map's own drawing code:
 * the real fill, pattern, dash, taper or icon. Used by the map key and by the
 * versions diff to show a style before and after.
 */
export function FeatureSwatch({ sample, settings, palette, dir, label }: { sample: MapFeature; settings: MapSettings; palette: Palette | null; dir: "ltr" | "rtl"; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !palette) return;
    const paint = () => {
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
    /* A number marker is text: repaint once its typeface has arrived. */
    return onFontsLoaded(paint);
  }, [sample, settings, palette, dir]);

  return label ? <canvas ref={ref} role="img" aria-label={label} className="h-4.5 w-7.5 shrink-0" /> : <canvas ref={ref} aria-hidden="true" className="h-4.5 w-7.5 shrink-0" />;
}
