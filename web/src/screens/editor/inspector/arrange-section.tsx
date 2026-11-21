import { cn } from "cn";
import { Button as RacButton } from "react-aria-components";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatShortcut, selectDrawOrder, shortcutFor, useEditorStore, useEditorStoreApi, type CommandId } from "@/editor/store";
import { useLang } from "@/i18n";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import type { MapFeature } from "@/model/types";
import { geodesicArea, geodesicLength } from "@/render/geo";
import { useEditorRuntime } from "../runtime";
import { formatArea, formatLength, formatLngLat, isMac } from "../shared/format";
import { useEditorLayout } from "../shared/layout";
import { Tip } from "../shared/tip";
import { Section } from "./parts";
import type { SectionProps } from "./style-sections";

/**
 * Draw order: where the selection sits in the stack, and four moves in one
 * joined strip read top to bottom of the stack. Keys are in the tooltips.
 */
export function OrderSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const store = useEditorStoreApi();
  const { touch } = useEditorLayout();
  const order = useEditorStore(selectDrawOrder);
  const mac = isMac();
  const single = summary.single;
  /* Draw order runs bottom first; the list and this readout count from the top. */
  const index = single ? order.findIndex((feature) => feature.id === single.id) : -1;
  const fromTop = index < 0 ? null : order.length - index;
  const moves: { id: CommandId; label: string; run: () => void }[] = [
    { id: "arrange.front", label: t.order.front, run: () => store.bringToFront() },
    { id: "arrange.forward", label: t.order.forward, run: () => store.stepForward() },
    { id: "arrange.backward", label: t.order.backward, run: () => store.stepBackward() },
    { id: "arrange.back", label: t.order.back, run: () => store.sendToBack() },
  ];
  return (
    <Section title={t.order.heading} aside={fromTop !== null ? <span className="tabular-nums">{t.order.position(fromTop, order.length)}</span> : null}>
      <div role="group" aria-label={t.order.heading} className="flex overflow-hidden rounded-field border border-rule-strong">
        {moves.map((move) => {
          const keys = shortcutFor(move.id)?.keys;
          return (
            <Tip key={move.id} label={move.label} keys={keys ? formatShortcut(keys, mac) : undefined}>
              <RacButton
                isDisabled={disabled}
                onPress={move.run}
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-center px-1 text-xs font-medium whitespace-nowrap text-ink-2 outline-none not-first:border-s not-first:border-rule-strong hover:bg-well hover:text-ink data-disabled:opacity-50 data-focus-visible:ring-2 data-focus-visible:ring-focus data-focus-visible:ring-inset data-pressed:bg-rule",
                  touch ? "h-11" : "h-field",
                )}
              >
                {move.label}
              </RacButton>
            </Tip>
          );
        })}
      </div>
    </Section>
  );
}

/** The two style clipboard commands, folded into one menu so the command row stays short. */
function StyleMenu({ disabled }: { disabled: boolean }) {
  const t = useInspectorStrings();
  const store = useEditorStoreApi();
  const { touch } = useEditorLayout();
  const hasClip = useEditorStore((state) => state.clipboard.style !== null);
  return (
    <DropdownMenuTrigger>
      <Button variant="ghost" size={touch ? "touch" : "default"}>
        {t.style.menu}
        <Icon name="chevronDown" size={12} />
      </Button>
      <DropdownMenu
        placement="bottom end"
        aria-label={t.style.menu}
        disabledKeys={[...(hasClip ? [] : ["paste"]), ...(disabled ? ["paste"] : [])]}
        onAction={(key) => (key === "copy" ? store.copyStyle() : store.pasteStyle())}
      >
        <DropdownMenuItem id="copy">{t.style.copy}</DropdownMenuItem>
        <DropdownMenuItem id="paste">{hasClip ? t.style.paste : `${t.style.paste} · ${t.style.nothingCopied}`}</DropdownMenuItem>
      </DropdownMenu>
    </DropdownMenuTrigger>
  );
}

function measure(feature: MapFeature, t: ReturnType<typeof useInspectorStrings>, lang: "en" | "ar"): string[] {
  switch (feature.kind) {
    case "area": {
      const outline = feature.rings[0] ?? [];
      const area = geodesicArea(outline) - feature.rings.slice(1).reduce((sum, hole) => sum + geodesicArea(hole), 0);
      return [`${t.shape.area} ${formatArea(Math.abs(area), lang)}`, `${t.shape.perimeter} ${formatLength(geodesicLength(outline), lang)}`, t.shape.vertices(Math.max(0, outline.length - 1))];
    }
    case "line":
    case "frontline":
      return [`${t.shape.length} ${formatLength(geodesicLength(feature.path), lang)}`, t.shape.vertices(feature.path.length)];
    case "arrow":
      return [`${t.shape.length} ${formatLength(geodesicLength(feature.control), lang)}`, t.shape.vertices(feature.control.length)];
    case "point":
      return [formatLngLat(feature.at)];
    case "annotation":
      return [formatLngLat(feature.anchor)];
  }
}

/** The geometry of one feature: reshape it, zoom to it, and a quiet readout of its size. */
export function ShapeSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const { controller } = useEditorRuntime();
  const { touch } = useEditorLayout();
  const reshapingId = useEditorStore((state) => state.view.reshapingId);
  const feature = summary.single;
  const size = touch ? "touch" : "default";

  if (!feature) {
    return (
      <div className="flex items-center gap-1.5 border-b border-rule px-3 py-2.5">
        <Button variant="outline" size={size} onPress={() => controller?.fitFeatures([...summary.ids])}>
          {t.shape.zoom}
        </Button>
        <span className="flex-1" />
        <StyleMenu disabled={disabled} />
      </div>
    );
  }
  const reshaping = reshapingId === feature.id;
  const canReshape = feature.kind !== "point";
  return (
    <div className="flex flex-col gap-2 border-b border-rule px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {canReshape ? (
          <Tip label={t.shape.orDoubleClick}>
            <Button variant={reshaping ? "default" : "outline"} size={size} isDisabled={disabled} aria-pressed={reshaping} onPress={() => store.setReshaping(reshaping ? null : feature.id)}>
              {reshaping ? t.shape.done : t.shape.edit}
            </Button>
          </Tip>
        ) : null}
        <Button variant="ghost" size={size} onPress={() => controller?.fitFeatures([feature.id])}>
          {t.shape.zoom}
        </Button>
        <span className="flex-1" />
        <StyleMenu disabled={disabled} />
      </div>
      {canReshape && reshaping ? (
        <p className="rounded-field border border-plum/40 px-2 py-1.5 text-xs text-ink">{feature.kind === "annotation" ? t.shape.hintAnnotation : t.shape.hint}</p>
      ) : null}
      <p className="text-xs text-ink-3 tabular-nums">
        <bdi>{measure(feature, t, lang).join(" · ")}</bdi>
      </p>
    </div>
  );
}
