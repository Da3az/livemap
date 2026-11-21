import type { ReactNode } from "react";
import type { ArrowFeature, DashStyle, FillPattern, FrontlineFeature, IconId, PointFeature } from "@/model/types";
import { ICON_GLYPHS, ICON_GRID, ICON_STROKE } from "@/render/icons";

/** Small drawings of style options. Each shows the thing itself, in the current text colour. */

function Frame({ children, width = 28 }: { children: ReactNode; width?: number }) {
  return (
    <svg width={width} height={16} viewBox={`0 0 ${width} 16`} fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function PatternDrawing({ pattern }: { pattern: FillPattern }) {
  return (
    <Frame width={20}>
      <rect x="1.5" y="1.5" width="17" height="13" rx="1.5" strokeWidth="1.2" fill="currentColor" fillOpacity={pattern === "none" ? 0.3 : 0} />
      {pattern === "hatch" || pattern === "cross" ? <path d="M3 13l8-10M8 14l9-11M13 14l5-6" strokeWidth="1.1" /> : null}
      {pattern === "cross" ? <path d="M17 13L9 3M12 14L3 3M7 14L2 8" strokeWidth="1.1" /> : null}
      {pattern === "dots" ? (
        <g fill="currentColor" stroke="none">
          {[5, 10, 15].flatMap((x) => [5, 11].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />))}
        </g>
      ) : null}
    </Frame>
  );
}

export function dashArray(dash: DashStyle, width: number): string | undefined {
  if (dash === "solid") return undefined;
  if (dash === "dashed") return `${width * 3} ${width * 2}`;
  if (dash === "dotted") return `0 ${width * 2}`;
  return dash.custom.map((part) => part * width).join(" ");
}

export function DashDrawing({ dash }: { dash: DashStyle }) {
  return (
    <Frame>
      <path d="M2 8h24" strokeWidth="2" strokeLinecap={dash === "dotted" ? "round" : "butt"} strokeDasharray={dashArray(dash, 2)} />
    </Frame>
  );
}

export function HeadDrawing({ head }: { head: ArrowFeature["head"] }) {
  return (
    <Frame>
      <path d={head === "double" ? "M7 8h14" : head === "single" ? "M3 8h18" : "M3 8h22"} strokeWidth="2" strokeLinecap="round" />
      {head !== "none" ? <path d="M19 3.5L26 8l-7 4.5z" fill="currentColor" stroke="none" /> : null}
      {head === "double" ? <path d="M9 3.5L2 8l7 4.5z" fill="currentColor" stroke="none" /> : null}
    </Frame>
  );
}

export function ToothDrawing({ shape }: { shape: FrontlineFeature["toothShape"] }) {
  return (
    <Frame>
      <path d="M2 12h24" strokeWidth="1.8" />
      <g fill="currentColor" stroke="none">
        {shape === "triangle" ? (
          <path d="M4 12l3.5-6 3.5 6zM17 12l3.5-6 3.5 6z" />
        ) : (
          <path d="M4 12a3.5 3.5 0 0 1 7 0zM17 12a3.5 3.5 0 0 1 7 0z" />
        )}
      </g>
    </Frame>
  );
}

export function WidthDrawing({ width }: { width: number }) {
  return (
    <Frame width={20}>
      <path d="M2 8h16" strokeWidth={width} strokeLinecap="round" />
    </Frame>
  );
}

export function TaperDrawing({ tapered }: { tapered: boolean }) {
  return (
    <Frame>
      {tapered ? <path d="M2 7.5L19 6v4L2 8.5z" fill="currentColor" stroke="none" /> : <path d="M2 8h17" strokeWidth="3" />}
      <path d="M18 3L26 8l-8 5z" fill="currentColor" stroke="none" />
    </Frame>
  );
}

/** A two-point arrow's arc. Drawn left to right, so bowing to the left of travel is up. */
export function BendDrawing({ bend }: { bend: NonNullable<ArrowFeature["bend"]> }) {
  const up = bend === "left";
  return (
    <Frame>
      <path d={up ? "M3 12Q13 0 22 10" : "M3 4Q13 16 22 6"} strokeWidth="1.8" />
      <path d={up ? "M19.5 6.5L23.5 11.5l-6 0.5" : "M19.5 9.5L23.5 4.5l-6 -0.5"} strokeWidth="1.4" strokeLinejoin="round" />
    </Frame>
  );
}

/** Drawn left to right, so "left" of the direction of travel is up. */
export function FacingDrawing({ facing }: { facing: FrontlineFeature["facing"] }) {
  const up = facing === "left";
  return (
    <Frame>
      <path d="M2 8h24" strokeWidth="1.8" />
      <path d="M21 5.5L25 8l-4 2.5" strokeWidth="1.2" />
      <path d={up ? "M4 8l3-5 3 5zM12 8l3-5 3 5z" : "M4 8l3 5 3-5zM12 8l3 5 3-5z"} fill="currentColor" stroke="none" />
    </Frame>
  );
}

export function SizeDrawing({ size }: { size: number }) {
  return (
    <Frame width={18}>
      <circle cx="9" cy="8" r={size} fill="currentColor" stroke="none" />
    </Frame>
  );
}

export function BackingDrawing({ backing }: { backing: "halo" | "box" | "none" }) {
  return (
    <Frame width={22}>
      {backing === "box" ? <rect x="1" y="2" width="20" height="12" rx="1.5" fill="currentColor" fillOpacity="0.3" stroke="none" /> : null}
      <text
        x="11"
        y="12"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill="currentColor"
        stroke={backing === "halo" ? "currentColor" : "none"}
        strokeOpacity="0.35"
        strokeWidth={backing === "halo" ? 3 : 0}
        paintOrder="stroke"
      >
        Aa
      </text>
    </Frame>
  );
}

export function LeaderDrawing({ leader }: { leader: "none" | "straight" | "elbow" }) {
  return (
    <Frame>
      <rect x="13" y="2" width="13" height="7" rx="1" strokeWidth="1.2" />
      {leader === "straight" ? <path d="M3 14L13 7" strokeWidth="1.3" /> : null}
      {leader === "elbow" ? <path d="M3 14V6h10" strokeWidth="1.3" /> : null}
      {leader !== "none" ? <circle cx="3" cy="14" r="1.6" fill="currentColor" stroke="none" /> : null}
    </Frame>
  );
}

/** One of the twelve event icons, from the same paths the map paints. */
export function GlyphDrawing({ icon, size = 18 }: { icon: IconId; size?: number }) {
  const glyph = ICON_GLYPHS[icon];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${ICON_GRID} ${ICON_GRID}`} aria-hidden="true" focusable="false">
      {glyph.fill ? <path d={glyph.fill} fill="currentColor" fillRule="evenodd" /> : null}
      {glyph.stroke ? <path d={glyph.stroke} fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}

/** An icon or a number marker as the map shows it: a disc in the feature's colour with the symbol on it. */
export function SymbolDrawing({ symbol, color, size = 20 }: { symbol: PointFeature["symbol"]; color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-pill text-2xs font-semibold text-white tabular-nums"
      style={{ backgroundColor: color, width: size, height: size }}
    >
      {"icon" in symbol ? <GlyphDrawing icon={symbol.icon} size={size} /> : <span dir="ltr">{symbol.number}</span>}
    </span>
  );
}

export const ICON_IDS = Object.keys(ICON_GLYPHS) as IconId[];
