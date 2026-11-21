import type { ExportImageOptions, ThemeMode } from "@/editor/controller";
import type { MapFeature, MapSettings, RichText, Viewport } from "@/model/types";
import { basemapTheme, blankStyle, buildBasemapStyle, effectiveStyleId, loadBasemapStyle } from "@/render/basemap";
import { FeatureRenderer } from "@/render/feature-renderer";
import { type FurnitureBands, loadFurnitureFonts, measureFurnitureBands, paintAttribution, paintFurniture } from "@/render/furniture-canvas";
import { metresPerPixel } from "@/render/geo";
import { createMap } from "@/render/maplibre";
import { readPalette } from "@/render/palette";
import { PatternCache } from "@/render/patterns";

/** What the controller hands over: a snapshot of what is on screen. */
export interface ExportSource {
  viewport: Viewport;
  /** Size of the on-screen map, so the image can cover the same ground. */
  screen: { width: number; height: number };
  features: readonly MapFeature[];
  settings: MapSettings;
  title: RichText;
  theme: ThemeMode;
  dir: "ltr" | "rtl";
  timeWindow: { from: string | null; to: string } | null;
  /** The largest WebGL canvas side this device supports. */
  maxCanvasSide: number;
  /** Where the screen placed each label, so the image shows the same labels in the same places. */
  labelChoices: ReadonlyMap<string, number>;
}

/** Tiles that have not arrived by now are left out; the image is still produced. */
const SETTLE_TIMEOUT_MS = 15_000;
/** Chromium refuses 2D canvases beyond these. */
const MAX_OUTPUT_SIDE = 16_384;
const MAX_OUTPUT_PIXELS = 160_000_000;
/** Within a quarter zoom step of the screen (the label bucket's width), labels are pinned. */
const LABEL_PIN_SCALE = 0.125;
/** Furniture goes into bands only while the map keeps at least this share of the image's height. */
const MIN_MAP_SHARE = 0.45;

function settle(map: ReturnType<typeof createMap>): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, SETTLE_TIMEOUT_MS);
    void map.once("idle").then(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Renders the map to a PNG of exactly `width × height × pixelRatio` pixels
 * with a second, off-screen map, so the result does not depend on the size of
 * the editor window. The features are painted by the same renderer the screen uses.
 */
export async function renderImage(source: ExportSource, options: ExportImageOptions): Promise<Blob> {
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  const pixelRatio = Math.max(1, Math.min(3, options.pixelRatio));
  const outWidth = Math.round(width * pixelRatio);
  const outHeight = Math.round(height * pixelRatio);
  if (!(width > 0 && height > 0)) throw new Error("An exported image needs a positive width and height.");
  if (outWidth > MAX_OUTPUT_SIDE || outHeight > MAX_OUTPUT_SIDE || outWidth * outHeight > MAX_OUTPUT_PIXELS) {
    throw new Error(`An image of ${outWidth} × ${outHeight} pixels is larger than this browser can produce.`);
  }
  const theme = options.theme ?? source.theme;

  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
    visibility: "hidden",
    pointerEvents: "none",
  });
  document.body.appendChild(container);

  const styleId = effectiveStyleId(source.settings.basemap.styleId, theme);
  const mapTheme = basemapTheme(styleId, theme);
  const palette = readPalette(container, mapTheme);
  const style = await loadBasemapStyle(styleId).then(
    (raw) => buildBasemapStyle(raw, styleId, { language: source.settings.basemap.labelLanguage, palette }),
    () => blankStyle(palette),
  );

  /*
   * With furniture, the title, key and credits are set in bands above and
   * below the map rather than over it, so they can never hide a feature or an
   * annotation. On an image too short for bands they fall back to sitting
   * over the map, as on screen.
   */
  const furnitureBase = {
    width,
    height,
    pixelRatio,
    title: source.title,
    settings: source.settings,
    features: source.features,
    palette,
    patterns: new PatternCache(),
    dir: source.dir,
    metresPerPixel: metresPerPixel(source.viewport.center[1], source.viewport.zoom),
    bearing: source.viewport.bearing,
    pitch: source.viewport.pitch,
  };
  let bands: FurnitureBands | null = null;
  if (options.furniture) {
    await loadFurnitureFonts(furnitureBase);
    const measured = measureFurnitureBands(furnitureBase);
    if (height - measured.top - measured.bottom >= height * MIN_MAP_SHARE) bands = measured;
  }
  const mapTop = bands?.top ?? 0;
  const mapHeight = height - mapTop - (bands?.bottom ?? 0);
  container.style.height = `${mapHeight}px`;

  /* The WebGL canvas has a hard size limit. Past it the basemap is rendered smaller and scaled up; the features and text are not. */
  const glRatio = Math.min(pixelRatio, source.maxCanvasSide / width, source.maxCanvasSide / mapHeight);
  const fit = Math.min(width / source.screen.width, mapHeight / source.screen.height);
  const zoom = source.viewport.zoom + Math.log2(fit);

  const map = createMap({
    container,
    style,
    center: source.viewport.center,
    zoom,
    bearing: source.viewport.bearing,
    pitch: source.viewport.pitch,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: glRatio,
    maxCanvasSize: [source.maxCanvasSide, source.maxCanvasSide],
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  const renderer = new FeatureRenderer(map, {
    features: source.features,
    settings: source.settings,
    theme: mapTheme,
    timeWindow: source.timeWindow,
    attach: false,
    labelHints: source.labelChoices,
    /*
     * At the screen's scale the screen's answer is the answer. At another
     * scale the same text covers a different share of the ground, so the
     * screen's answer is only where each label tries first.
     */
    pinLabels: Math.abs(Math.log2(fit)) < LABEL_PIN_SCALE,
  });

  try {
    await settle(map);
    const furnitureInput = { ...furnitureBase, metresPerPixel: metresPerPixel(source.viewport.center[1], zoom), ...(bands ? { bands } : {}) };
    await renderer.whenFontsReady();

    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot create a 2D canvas for the image.");
    context.drawImage(map.getCanvas(), 0, Math.round(mapTop * pixelRatio), outWidth, Math.round(mapHeight * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.save();
    context.beginPath();
    context.rect(0, mapTop, width, mapHeight);
    context.clip();
    context.translate(0, mapTop);
    renderer.paintInto(context, renderer.view(), pixelRatio);
    context.restore();
    if (options.furniture) paintFurniture(context, furnitureInput);
    else paintAttribution(context, furnitureInput);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image could not be encoded."))), "image/png");
    });
  } finally {
    renderer.destroy();
    map.remove();
    container.remove();
  }
}
