import { useMemo, useState } from "react";
import { useVersion } from "@/api/hooks";
import { useTheme } from "@/app/providers";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useVersionsStrings } from "@/i18n/versions";
import type { MapDoc } from "@/model/types";
import { MapViewer } from "@/screens/embed/viewer";
import { CopyButton } from "./copy";
import { EmbedSnippet } from "./embed-snippet";
import { DEFAULT_EMBED, embedAttributes, embedCode, embedMinHeight, type EmbedOptions, embedUrl } from "./model";

const RATIOS = ["16/9", "4/3", "1/1", "4/5"] as const;
const WIDTHS = { phone: 390, tablet: 768, desktop: null } as const;
type Width = keyof typeof WIDTHS;

const FIELD = "h-field w-20 min-w-0 rounded-field border border-rule-strong bg-panel px-2 text-sm text-ink tabular-nums max-md:h-10 max-md:text-base";

/** A compact segmented control: one row of words, one chosen. */
function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; text: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="w-16 shrink-0 text-xs text-ink-3">{label}</span>
      <ToggleGroup
        aria-label={label}
        spacing={0}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[value]}
        onSelectionChange={(keys) => {
          const next = options.find((option) => option.id === [...keys][0]);
          if (next) onChange(next.id);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.id} id={option.id} className="max-md:h-10">
            {option.text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/**
 * The code a newsroom CMS needs to place this map, the options that change
 * it, and the embed itself at the widths readers will have.
 */
export function EmbedTab({ map, tenantSlug, liveVersion }: { map: MapDoc; tenantSlug: string; liveVersion: number | null }) {
  const t = useVersionsStrings();
  const { mode } = useTheme();
  const [options, setOptions] = useState<EmbedOptions>(DEFAULT_EMBED);
  const [width, setWidth] = useState<Width>("desktop");
  const live = useVersion(map.id, liveVersion);
  const set = (patch: Partial<EmbedOptions>) => setOptions((current) => ({ ...current, ...patch }));

  const url = embedUrl(window.location.origin, tenantSlug, map.slug, options);
  const setting = map.settings.embed;
  const minHeight = embedMinHeight(map.settings.timeline.enabled && !(options.staticPicture || setting.static));
  const attributes = useMemo(() => embedAttributes(url, map.title.value, options, minHeight), [url, map.title.value, options, minHeight]);
  const code = embedCode(url, map.title.value, options, minHeight);
  /* "Follow the reader's system" has no reader here; the app's own theme stands in for one. */
  const chosen = options.theme === "map" ? setting.theme : options.theme;
  const previewTheme = chosen === "auto" ? mode : chosen;
  const frameWidth = WIDTHS[width];
  const frameStyle =
    options.size.kind === "ratio"
      ? { aspectRatio: options.size.ratio, minHeight, maxWidth: frameWidth ?? undefined }
      : { height: options.size.px, maxWidth: frameWidth ?? undefined };

  return (
    <div className="flex min-h-0 flex-1 flex-col md:overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section className="min-w-0 px-4 py-3 md:px-5 lg:w-2/5 lg:max-w-xl lg:shrink-0 lg:overflow-y-auto lg:border-e lg:border-rule-strong">
        <div className="flex items-center gap-3">
          <h2 className="font-title text-lg font-semibold text-ink">{t.embedCode}</h2>
          <CopyButton text={code} label={t.copyCode} className="ms-auto border-survey bg-survey text-on-survey hover:bg-survey/90" />
        </div>

        <div role="group" aria-label={t.optionsLabel} className="mt-2 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Segments
              label={t.sizeShort}
              value={options.size.kind === "ratio" ? options.size.ratio : "fixed"}
              options={[...RATIOS.map((ratio) => ({ id: ratio, text: t.ratioShort(ratio) })), { id: "fixed" as const, text: t.fixedShort }]}
              onChange={(next) => set({ size: next === "fixed" ? { kind: "height", px: options.size.kind === "height" ? options.size.px : 560 } : { kind: "ratio", ratio: next } })}
            />
            {options.size.kind === "height" ? (
              <label className="flex items-center gap-1 text-sm text-ink-3">
                <input
                  aria-label={t.height}
                  type="number"
                  inputMode="numeric"
                  min={240}
                  max={1600}
                  step={20}
                  value={options.size.px}
                  onChange={(event) => set({ size: { kind: "height", px: Math.max(240, Math.min(1600, Number(event.target.value) || 240)) } })}
                  className={FIELD}
                />
                {t.px}
              </label>
            ) : null}
          </div>
          <Segments
            label={t.themeShort}
            value={options.theme}
            options={[
              { id: "map", text: t.themeMapShort(t.themeSetting(setting.theme)) },
              { id: "light", text: t.themeLight },
              { id: "dark", text: t.themeDark },
              { id: "auto", text: t.themeAutoShort },
            ]}
            onChange={(theme) => set({ theme })}
          />
          <Segments
            label={t.keyShort}
            value={options.key === null ? "map" : options.key ? "on" : "off"}
            options={[
              { id: "map", text: t.keyMapShort(setting.legend) },
              { id: "on", text: t.keyOn },
              { id: "off", text: t.keyOff },
            ]}
            onChange={(key) => set({ key: key === "map" ? null : key === "on" })}
          />
          <Segments
            label={t.modeShort}
            value={options.staticPicture ? "picture" : "move"}
            options={[
              { id: "move", text: t.modeMove },
              { id: "picture", text: t.modePicture },
            ]}
            onChange={(mode) => set({ staticPicture: mode === "picture" })}
          />
          <label className="flex min-h-field items-center gap-2 ps-18 text-sm text-ink-2 max-md:min-h-10">
            <input type="checkbox" className="size-4 shrink-0 accent-survey" checked={options.lazy} onChange={(event) => set({ lazy: event.target.checked })} />
            {t.lazyShort}
          </label>
        </div>

        <div className="mt-3">
          <EmbedSnippet attributes={attributes} />
        </div>
        <p className="mt-2 flex items-start gap-2 text-xs text-ink-3">
          <span className="shrink-0">{t.embedAddress}</span>
          <span dir="ltr" className="min-w-0 break-all text-ink-2">
            {url}
          </span>
          <CopyButton compact text={url} label={t.copyUrl} />
        </p>
      </section>

      <section aria-label={t.preview} className="flex min-w-0 shrink-0 flex-col bg-page lg:flex-1 lg:shrink lg:overflow-y-auto">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-rule bg-panel px-4 py-2 md:px-5">
          <h2 className="text-2xs font-semibold tracking-wide text-plum uppercase">{t.preview}</h2>
          <ToggleGroup aria-label={t.previewWidth} spacing={0} selectionMode="single" disallowEmptySelection selectedKeys={[width]} onSelectionChange={(keys) => {
              const next = [...keys][0];
              setWidth(next === "phone" || next === "tablet" ? next : "desktop");
            }}>
            <ToggleGroupItem id="phone" className="max-md:h-10">
              {t.phone}
            </ToggleGroupItem>
            <ToggleGroupItem id="tablet" className="max-md:h-10">
              {t.tablet}
            </ToggleGroupItem>
            <ToggleGroupItem id="desktop" className="max-md:h-10">
              {t.desktop}
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-xs text-ink-3 tabular-nums">
            {frameWidth ? t.widthPx(frameWidth) : null}
            {liveVersion !== null ? ` ${frameWidth ? "· " : ""}${t.previewOf(liveVersion)}` : ""}
          </span>
        </div>
        <div className="min-w-0 flex-1 p-4 md:p-5">
          {liveVersion === null ? (
            <p className="max-w-prose text-base text-ink-2">{t.previewNothing}</p>
          ) : live.isSuccess ? (
            <div style={frameStyle} className="w-full border border-rule-strong bg-panel">
              <MapViewer version={live.data} theme={previewTheme} static={options.staticPicture ? true : undefined} legend={options.key ?? undefined} className="size-full" />
            </div>
          ) : live.isError ? (
            <p role="alert" className="text-sm text-danger">
              {t.versionFailed}: {live.error.reason}
            </p>
          ) : (
            <div aria-busy="true" style={frameStyle} className="w-full border border-rule bg-well" />
          )}
        </div>
      </section>
    </div>
  );
}
