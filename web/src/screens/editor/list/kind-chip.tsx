import { memo, useId } from "react";
import type { Swatch } from "@/editor/store";
import type { DashStyle, FillPattern } from "@/model/types";
import { ICON_GLYPHS, ICON_STROKE } from "@/render/icons";
import { readableOn, resolveColor, type Palette } from "@/render/palette";
import { toCss } from "@/render/color";
import { colorCss, useMapPalette } from "../shared/palette";

function dashArray(dash: DashStyle | undefined): string | undefined {
  if (dash === undefined || dash === "solid") return undefined;
  if (dash === "dotted") return "0.1 2.6";
  return "3 2";
}

function PatternDef({ id, pattern, color }: { id: string; pattern: Exclude<FillPattern, "none">; color: string }) {
  return (
    <pattern id={id} width="3.2" height="3.2" patternUnits="userSpaceOnUse">
      {pattern === "dots" ? (
        <circle cx="1.6" cy="1.6" r="0.75" fill={color} />
      ) : (
        <>
          <path d="M-0.8 0.8L0.8-0.8M0 3.2L3.2 0M2.4 4L4 2.4" stroke={color} strokeWidth="0.9" />
          {pattern === "cross" ? <path d="M-0.8 2.4L0.8 4M0 0L3.2 3.2M2.4-0.8L4 0.8" stroke={color} strokeWidth="0.9" /> : null}
        </>
      )}
    </pattern>
  );
}

function onColor(swatch: Swatch, palette: Palette | null): string {
  if (!palette || swatch.color === null) return "var(--panel)";
  return toCss(readableOn(resolveColor(swatch.color, palette), palette));
}

/**
 * The kind of a feature, drawn in the feature's own colour: it is the row's
 * icon and its colour chip at once. Areas show their fill pattern, lines
 * their dash, arrows their head, front lines their teeth, icons their glyph.
 */
export const KindChip = memo(function KindChip({ swatch }: { swatch: Swatch }) {
  const palette = useMapPalette();
  const patternId = useId();
  const color = colorCss(swatch.color, palette);
  const dash = dashArray(swatch.stroke?.dash);
  const cap = swatch.stroke?.dash === "dotted" ? "round" : "butt";
  const common = { fill: "none", stroke: color, strokeWidth: 1.6, strokeDasharray: dash, strokeLinecap: cap, strokeLinejoin: "round" } as const;

  let body: React.ReactNode;
  switch (swatch.kind) {
    case "area": {
      const fill = swatch.fill;
      const fillColor = colorCss(fill?.color ?? swatch.color, palette);
      const pattern = fill?.pattern ?? "none";
      body = (
        <>
          {pattern !== "none" ? (
            <defs>
              <PatternDef id={patternId} pattern={pattern} color={fillColor} />
            </defs>
          ) : null}
          <path d="M2.5 3.5h11v9h-11z" fill={fillColor} fillOpacity={pattern === "none" ? Math.max(0.2, Math.min(0.7, fill?.opacity ?? 0.3)) : 0.12} />
          {pattern !== "none" ? <path d="M2.5 3.5h11v9h-11z" fill={`url(#${CSS.escape(patternId)})`} /> : null}
          <path d="M2.5 3.5h11v9h-11z" {...common} strokeWidth={1.4} />
        </>
      );
      break;
    }
    case "line":
      body = <path d="M2 12l4-6.5 3.5 4L14 4" {...common} strokeWidth={1.8} />;
      break;
    case "arrow":
      body = (
        <>
          <path d="M2.5 12.5C4 7.5 7 5 11 4.8" {...common} strokeWidth={1.8} />
          <path d="M9.6 2.2l4 2.4-3 3.4z" fill={color} />
        </>
      );
      break;
    case "frontline":
      body = (
        <>
          <path d="M1.5 11h13" {...common} strokeWidth={1.8} />
          <path d="M3 10.2l1.9-3.6 1.9 3.6zM9.2 10.2l1.9-3.6 1.9 3.6z" fill={color} />
        </>
      );
      break;
    case "point": {
      const symbol = swatch.symbol;
      const inner = onColor(swatch, palette);
      body = (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          {symbol && "number" in symbol ? (
            <text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill={inner} fontSize={symbol.number.length > 2 ? 6 : symbol.number.length > 1 ? 7.5 : 9} fontWeight="600" direction="ltr">
              {symbol.number}
            </text>
          ) : symbol ? (
            <g transform="translate(-1 -1) scale(0.75)">
              {ICON_GLYPHS[symbol.icon].fill ? <path d={ICON_GLYPHS[symbol.icon].fill} fill={inner} fillRule="evenodd" /> : null}
              {ICON_GLYPHS[symbol.icon].stroke ? (
                <path d={ICON_GLYPHS[symbol.icon].stroke} fill="none" stroke={inner} strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" />
              ) : null}
            </g>
          ) : null}
        </>
      );
      break;
    }
    case "annotation":
      body = <path d="M3.5 4h9M8 4v9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />;
      break;
  }

  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="shrink-0 text-ink-2">
      {body}
    </svg>
  );
});
