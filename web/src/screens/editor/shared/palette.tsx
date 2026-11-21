import { createContext, useContext, useMemo, type ReactNode, type RefObject } from "react";
import { useTheme } from "@/app/providers";
import { useEditorStore } from "@/editor/store";
import type { ColorRef, PaletteSlot } from "@/model/types";
import { basemapTheme } from "@/render/basemap";
import { toCss } from "@/render/color";
import type { Palette, ThemeMode } from "@/render/palette";
import { usePalette } from "@/render/use-palette";

interface MapPaletteValue {
  /** null until the editor root has mounted and the tokens were read. */
  palette: Palette | null;
  /** The basemap's own light or dark, which may differ from the interface theme. */
  theme: ThemeMode;
}

const MapPaletteContext = createContext<MapPaletteValue>({ palette: null, theme: "light" });

/**
 * The colours the map is drawn with, for every chip, swatch and preview in
 * the editor. They follow the basemap, not the interface theme: a dark
 * basemap in a light interface still shows its own eight colours.
 */
export function MapPaletteProvider({ rootRef, children }: { rootRef: RefObject<HTMLElement | null>; children: ReactNode }) {
  const { mode } = useTheme();
  const styleId = useEditorStore((state) => state.doc.settings.basemap.styleId);
  const theme = basemapTheme(styleId, mode);
  const palette = usePalette(rootRef, theme);
  const value = useMemo(() => ({ palette, theme }), [palette, theme]);
  return <MapPaletteContext.Provider value={value}>{children}</MapPaletteContext.Provider>;
}

export function useMapPalette(): Palette | null {
  return useContext(MapPaletteContext).palette;
}

export function useMapTheme(): ThemeMode {
  return useContext(MapPaletteContext).theme;
}

export const PALETTE_SLOTS: PaletteSlot[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** A CSS colour for a feature's colour reference, as the map draws it. */
export function colorCss(ref: ColorRef | "ink" | null | undefined, palette: Palette | null): string {
  if (ref === null || ref === undefined) return "currentColor";
  if (ref === "ink") return palette ? toCss(palette.ink) : "currentColor";
  if ("custom" in ref) return ref.custom;
  const slot = palette?.slots[ref.slot - 1];
  return slot ? toCss(slot) : `var(--map-${ref.slot})`;
}
