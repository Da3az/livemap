import { cn } from "cn";
import { Radio, RadioGroup } from "react-aria-components";
import { useTheme } from "@/app/providers";
import { Icon } from "@/components/icons";
import { useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useExtrasStrings } from "@/i18n/editor-extras";
import type { LabelLanguage } from "@/model/types";
import { effectiveStyleId } from "@/render/basemap";
import { Section, Segmented } from "../shared/controls";
import { BASEMAP_LOOKS, type BasemapLook } from "./basemap-looks";

const LANGUAGES: LabelLanguage[] = ["ar", "en", "local"];

/** A style colour as the renderer shows it: halfway toward the land, unless the style is left as drawn. */
function muted(look: BasemapLook, colour: string): string {
  return look.tinted ? `color-mix(in srgb, ${colour} 50%, var(--map-land))` : colour;
}

/** A coast, a wood, a main road with its casing and a side road, in the style's own colours as the map shows them. */
function StyleDrawingTile({ look }: { look: BasemapLook }) {
  const land = look.land ?? "var(--map-land)";
  const water = look.water ?? "var(--map-water)";
  const major = look.major;
  return (
    <span className={cn("block h-10 w-16 shrink-0 overflow-hidden rounded-key border border-rule-strong", look.dark && "dark")}>
      <svg viewBox="0 0 64 40" aria-hidden="true" className="size-full">
        <rect width="64" height="40" style={{ fill: land }} />
        {look.green !== null ? <path d="M4 4h14l3 6-4 6H6z" style={{ fill: muted(look, look.green), fillOpacity: 0.6 }} /> : null}
        <path d="M40 0C35 9 46 14 42 23 39 31 47 35 45 40H64V0z" style={{ fill: water }} />
        <path d="M12 40C13 32 18 29 24 26" fill="none" style={{ stroke: muted(look, look.minor.fill), strokeWidth: look.minor.width }} />
        {major.casing !== null ? (
          <path d="M0 27C11 24 20 29 30 21 34 18 36 10 35 0" fill="none" style={{ stroke: muted(look, major.casing), strokeWidth: major.width + 1.6 }} />
        ) : null}
        <path d="M0 27C11 24 20 29 30 21 34 18 36 10 35 0" fill="none" style={{ stroke: muted(look, major.fill), strokeWidth: major.width }} />
      </svg>
    </span>
  );
}

/** The basemap under the features, the language its place names are pinned to, and what readers will actually get. */
export function BasemapSection({ disabled }: { disabled: boolean }) {
  const store = useEditorStoreApi();
  const strings = useExtrasStrings();
  const t = strings.settings.basemap;
  const { mode } = useTheme();
  const basemap = useEditorStore((state) => state.doc.settings.basemap);
  const embedTheme = useEditorStore((state) => state.doc.settings.embed.theme);

  const name = strings.names.basemap[basemap.styleId];
  const darkName = strings.names.basemap[effectiveStyleId(basemap.styleId, "dark")];
  const language = strings.names.labelLanguage[basemap.labelLanguage];
  const published =
    embedTheme === "light" || darkName === name
      ? t.publishedAs(name, language)
      : embedTheme === "dark"
        ? t.publishedDark(darkName, language)
        : t.publishedAuto(name, darkName, language);

  return (
    <Section id="basemap" title={t.heading} summary={`${name} · ${language}`}>
      <RadioGroup
        aria-label={t.style}
        value={basemap.styleId}
        isDisabled={disabled}
        onChange={(next) => {
          const style = BASEMAP_LOOKS.find((candidate) => candidate.id === next);
          if (style !== undefined) store.setBasemap({ styleId: style.id });
        }}
        className="flex flex-col gap-0.5"
      >
        {BASEMAP_LOOKS.map((style) => (
          <Radio
            key={style.id}
            value={style.id}
            data-basemap={style.id}
            className={({ isSelected, isFocusVisible, isDisabled }) =>
              cn(
                "flex cursor-default items-center gap-2.5 rounded-block border p-1",
                isSelected ? "border-survey bg-survey/10" : "border-transparent hover:bg-well",
                isFocusVisible && "outline-2 outline-offset-1 outline-focus",
                isDisabled && "opacity-50",
              )
            }
          >
            {({ isSelected }) => (
              <>
                <StyleDrawingTile look={style} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("text-sm text-ink", isSelected && "font-semibold")}>{strings.names.basemap[style.id]}</span>
                  <span className="text-xs text-ink-3">{t.about[style.id]}</span>
                </span>
                {isSelected ? <Icon name="check" size={14} className="me-1 shrink-0 text-survey" /> : null}
              </>
            )}
          </Radio>
        ))}
      </RadioGroup>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-2">{t.language}</span>
        <Segmented
          label={t.language}
          value={basemap.labelLanguage}
          disabled={disabled}
          className="w-full"
          onChange={(labelLanguage) => store.setBasemap({ labelLanguage })}
          options={LANGUAGES.map((id) => ({ value: id, label: strings.names.labelLanguage[id] }))}
        />
        {basemap.labelLanguage === "local" ? <p className="text-xs text-ink-3">{t.localHint}</p> : null}
      </div>
      <p data-basemap-note className="border-s-2 border-info ps-2 text-xs text-ink-2">
        {published}
        {mode === "dark" && darkName !== name ? ` ${t.editorDark(darkName)}` : ""}
      </p>
    </Section>
  );
}
