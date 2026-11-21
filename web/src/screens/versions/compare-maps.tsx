import { type RefObject, useCallback, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LangProvider } from "@/i18n";
import { useVersionsStrings } from "@/i18n/versions";
import type { MapFeature, MapVersion, Viewport } from "@/model/types";
import { BasemapAttribution, MapViewer, type MapViewerHandle } from "@/screens/embed/viewer";

const SIDE_BY_SIDE = "(min-width: 48rem)";

function useSideBySide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(SIDE_BY_SIDE);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(SIDE_BY_SIDE).matches,
  );
}

export interface CompareMapsHandle {
  /** Bring a feature into view on every map that is showing. */
  show(feature: MapFeature): void;
}

export interface CompareSide {
  version: MapVersion;
  /** "v13" or "Draft · rev 97" */
  name: string;
  detail: string;
}

function Caption({ side }: { side: CompareSide }) {
  return (
    <p className="flex h-row shrink-0 items-baseline gap-2 border-b border-rule px-3 pt-1.5">
      <span className="font-title text-base font-semibold text-ink tabular-nums">{side.name}</span>
      <span className="truncate text-xs text-ink-3 tabular-nums">{side.detail}</span>
    </p>
  );
}

/**
 * The two versions as maps. From the tablet width up they sit side by side
 * with linked cameras; on a phone there is one map and a switch between the
 * two versions, which flips them in place on the same view.
 *
 * Only these maps exist while comparing: two WebGL contexts at most, both
 * released when this unmounts.
 */
export function CompareMaps({ from, to, theme, highlightId, handleRef }: { from: CompareSide; to: CompareSide; theme: "light" | "dark"; highlightId: string | null; handleRef: Ref<CompareMapsHandle> }) {
  const t = useVersionsStrings();
  const sideBySide = useSideBySide();
  const [shown, setShown] = useState<"from" | "to">("to");
  const a = useRef<MapViewerHandle>(null);
  const b = useRef<MapViewerHandle>(null);
  const linking = useRef(false);
  const highlight = highlightId === null ? undefined : [highlightId];
  /* Both open on the newer version's opening view, so they start on the same ground. */
  const opening = to.version.settings.openingView;

  const follow = useCallback((other: RefObject<MapViewerHandle | null>) => {
    return (viewport: Viewport) => {
      if (linking.current) return;
      linking.current = true;
      other.current?.setViewport(viewport);
      linking.current = false;
    };
  }, []);
  const [aMoved] = useState(() => follow(b));
  const [bMoved] = useState(() => follow(a));

  useImperativeHandle(handleRef, () => ({ show: (feature) => (a.current ?? b.current)?.fitFeature(feature) }), []);

  const viewer = (side: CompareSide, ref: Ref<MapViewerHandle>, onViewport?: (viewport: Viewport) => void) => (
    <MapViewer version={side.version} furniture="map" legend={false} scaleBar={false} static={false} zoomButtons theme={theme} initialViewport={opening} highlightIds={highlight} handleRef={ref} onViewport={onViewport} className="min-h-0 flex-1" />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sideBySide ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col border-e border-rule-strong">
            <Caption side={from} />
            {viewer(from, a, aMoved)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <Caption side={to} />
            {viewer(to, b, bMoved)}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-rule px-4 py-2">
            <ToggleGroup aria-label={t.mapsToggle} spacing={0} selectionMode="single" disallowEmptySelection selectedKeys={[shown]} onSelectionChange={(keys) => setShown([...keys][0] === "from" ? "from" : "to")}>
              <ToggleGroupItem id="from" className="h-10 px-4 text-base tabular-nums">
                {from.name}
              </ToggleGroupItem>
              <ToggleGroupItem id="to" className="h-10 px-4 text-base tabular-nums">
                {to.name}
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="truncate text-xs text-ink-3 tabular-nums">{(shown === "from" ? from : to).detail}</span>
          </div>
          {viewer(shown === "from" ? from : to, a)}
        </div>
      )}
      <p className="flex shrink-0 flex-wrap gap-x-4 border-t border-rule px-3 py-1 text-2xs text-ink-3">
        {sideBySide ? <span>{t.linked}</span> : null}
        <LangProvider lang="en">
          <BasemapAttribution className="ms-auto" />
        </LangProvider>
      </p>
    </div>
  );
}
