// `AnnotationFeature.offset` is in screen px and the leader geometry is derived
// per view; a geographic offset collapses on zoom out. The style spec cannot
// express a line from a geographic anchor to a screen-offset label, so the
// leader ships as a small GeoJSON source the renderer refreshes on move/zoom.

import type { AnnotationFeature, LngLat, TextDir } from "./types.js";
import { lngLatToPx, pxToLngLat, type WorldXY } from "./geo.js";

export interface BuiltLeader {
  /** Leader polyline in geographic coords, anchor end first. */
  readonly path: readonly LngLat[];
  readonly textAt: LngLat;
  readonly anchorAt: LngLat;
  /** "auto" already resolved. */
  readonly dir: Exclude<TextDir, "auto">;
  /** Side the leader attaches to, so the box never covers its own leader. */
  readonly attach: "left" | "right" | "top" | "bottom";
}

/**
 * First strong directional character, per the Unicode bidi first-strong
 * heuristic. Only applies to `dir: "auto"`; an explicit `dir` is honoured.
 */
export function resolveDir(
  text: string,
  declared: TextDir,
): Exclude<TextDir, "auto"> {
  if (declared !== "auto") return declared;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    // Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan + Arabic presentation forms.
    if (
      (c >= 0x0590 && c <= 0x08ff) ||
      (c >= 0xfb1d && c <= 0xfdff) ||
      (c >= 0xfe70 && c <= 0xfeff)
    ) {
      return "rtl";
    }
    // Latin, Greek, Cyrillic and most other strong-LTR ranges.
    if (
      (c >= 0x0041 && c <= 0x005a) ||
      (c >= 0x0061 && c <= 0x007a) ||
      (c >= 0x00c0 && c <= 0x058f) ||
      (c >= 0x0900 && c <= 0x1fff)
    ) {
      return "ltr";
    }
  }
  return "ltr";
}

/** Horizontal dominance wins: text boxes are wider than they are tall. */
function attachSide(
  dx: number,
  dy: number,
): "left" | "right" | "top" | "bottom" {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "left" : "right";
  }
  return dy >= 0 ? "top" : "bottom";
}

export interface LeaderBuildOptions {
  /** Px gap at the anchor end, so the line clears the anchor dot. */
  readonly anchorGapPx?: number;
  /** Px gap between the leader end and the text box edge. */
  readonly textGapPx?: number;
  readonly tileSize?: number;
}

const LEADER_DEFAULTS = {
  anchorGapPx: 4,
  textGapPx: 3,
  tileSize: 512,
} as const;

/**
 * Zoom only, no bearing/pitch: offsets are applied in unrotated Mercator px, so
 * a rotated camera rotates the label offset with the map. True viewport-space
 * offsets would make labels swim when the user rotates.
 */
export function buildLeaderForView(
  feature: AnnotationFeature,
  zoom: number,
  options: LeaderBuildOptions = {},
): BuiltLeader {
  const opts = { ...LEADER_DEFAULTS, ...options };
  const [dx, dy] = feature.offset;

  const anchorPx = lngLatToPx(feature.anchor, zoom, opts.tileSize);
  const textPx: WorldXY = { x: anchorPx.x + dx, y: anchorPx.y + dy };

  const dir = resolveDir(feature.text.value, feature.text.dir);
  const attach = attachSide(dx, dy);
  const textAt = pxToLngLat(textPx, zoom, opts.tileSize);

  if (!feature.leader) {
    return { path: [], textAt, anchorAt: feature.anchor, dir, attach };
  }

  const len = Math.hypot(dx, dy);
  // No room for a leader; draw none rather than a zero-length artefact.
  if (len <= opts.anchorGapPx + opts.textGapPx) {
    return { path: [], textAt, anchorAt: feature.anchor, dir, attach };
  }

  const ux = dx / len;
  const uy = dy / len;

  const startPx: WorldXY = {
    x: anchorPx.x + ux * opts.anchorGapPx,
    y: anchorPx.y + uy * opts.anchorGapPx,
  };
  const endPx: WorldXY = {
    x: textPx.x - ux * opts.textGapPx,
    y: textPx.y - uy * opts.textGapPx,
  };

  const pxPath: WorldXY[] =
    feature.leader.shape === "elbow"
      ? // Horizontal first: keeps the bend away from the text baseline.
        [startPx, { x: endPx.x, y: startPx.y }, endPx]
      : [startPx, endPx];

  return {
    path: pxPath.map((p) => pxToLngLat(p, zoom, opts.tileSize)),
    textAt,
    anchorAt: feature.anchor,
    dir,
    attach,
  };
}

/** Mean advance width as a fraction of font size. CJK is close to square. */
const ADVANCE_RATIO = {
  latin: 0.52,
  arabic: 0.58,
  cjk: 1.0,
} as const;

function scriptClass(text: string): keyof typeof ADVANCE_RATIO {
  let arabic = 0;
  let cjk = 0;
  let total = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x20) continue;
    total++;
    if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0xfb50 && c <= 0xfeff)) arabic++;
    else if (c >= 0x3000 && c <= 0x9fff) cjk++;
  }
  if (total === 0) return "latin";
  if (cjk / total > 0.3) return "cjk";
  if (arabic / total > 0.3) return "arabic";
  return "latin";
}

export interface TextBox {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly lines: number;
}

/**
 * Estimate only: roughly +/-15% against real font metrics. Fine for collision
 * avoidance with a padding allowance; do not use for layout.
 */
export function estimateTextBox(
  text: string,
  fontSizePx: number,
  maxWidthPx = 220,
): TextBox {
  const ratio = ADVANCE_RATIO[scriptClass(text)];
  const charW = fontSizePx * ratio;
  const lineH = fontSizePx * 1.25;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { widthPx: 0, heightPx: 0, lines: 0 };

  let lines = 1;
  let cur = 0;
  let widest = 0;

  for (const w of words) {
    const wordW = w.length * charW;
    const withSpace = cur === 0 ? wordW : cur + charW + wordW;
    if (withSpace > maxWidthPx && cur > 0) {
      widest = Math.max(widest, cur);
      lines++;
      cur = wordW;
    } else {
      cur = withSpace;
    }
  }
  widest = Math.max(widest, cur);

  return {
    widthPx: Math.min(widest, maxWidthPx),
    heightPx: lines * lineH,
    lines,
  };
}
