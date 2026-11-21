import { useEffect, useState, type RefObject } from "react";
import { readPalette, type Palette, type ThemeMode } from "./palette";

/**
 * The map palette in scope at an element. It is read again when the theme
 * prop changes and when the document's theme class does, because a host may
 * flip one a frame before the other.
 */
export function usePalette(ref: RefObject<HTMLElement | null>, theme: ThemeMode): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () =>
      setPalette((current) => {
        const next = readPalette(element, theme);
        return current?.key === next.key ? current : next;
      });
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [ref, theme]);
  return palette;
}
