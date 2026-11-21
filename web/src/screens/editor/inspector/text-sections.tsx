import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditorStoreApi } from "@/editor/store";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import type { RichText, TextDir } from "@/model/types";
import { resolveDir } from "@/render/text";
import { useEditorLayout } from "../shared/layout";
import { ColorControl } from "./color-control";
import { BackingDraw, LeaderDraw } from "./drawings";
import { Caption, has, isMixed, Line, PIXELS, Section, SliderField, Tiles, valueOf } from "./parts";
import { useRestyle, type SectionProps } from "./style-sections";

const DIRS: TextDir[] = ["auto", "ltr", "rtl"];

function isDir(key: unknown): key is TextDir {
  return DIRS.some((dir) => dir === key);
}

/**
 * Which way a piece of text runs: detected from its first strong character,
 * or pinned. With "auto" the detected direction is written beside the control.
 */
function DirectionControl({ text, onChange, disabled }: { text: RichText; onChange: (dir: TextDir) => void; disabled: boolean }) {
  const t = useInspectorStrings();
  const { touch } = useEditorLayout();
  const words: Record<TextDir, string> = { auto: t.text.auto, ltr: t.text.ltrShort, rtl: t.text.rtlShort };
  const full: Record<TextDir, string> = { auto: t.text.auto, ltr: t.text.ltr, rtl: t.text.rtl };
  return (
    <div className="flex items-center gap-2">
      <ToggleGroup
        aria-label={t.text.direction}
        size={touch ? "lg" : "sm"}
        spacing={0}
        selectionMode="single"
        disallowEmptySelection
        isDisabled={disabled}
        selectedKeys={[text.dir]}
        onSelectionChange={(keys) => {
          const next = [...keys][0];
          if (isDir(next)) onChange(next);
        }}
      >
        {DIRS.map((dir) => (
          <ToggleGroupItem key={dir} id={dir} aria-label={full[dir]} className={touch ? "h-11" : undefined}>
            {words[dir]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {text.dir === "auto" && text.value.trim() !== "" ? <span className="min-w-0 truncate text-2xs text-ink-3">{t.text.detected(resolveDir(text))}</span> : null}
    </div>
  );
}

type Backing = "none" | "halo" | "box";
const BACKINGS: Backing[] = ["none", "halo", "box"];
const WEIGHTS = [400, 600] as const;

/** Size, weight, colour and what sits behind the text: shared by annotations and feature labels. */
function TextStyleControls({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const store = useEditorStoreApi();
  const { touch } = useEditorLayout();
  const { set, commit } = useRestyle();
  const { style } = summary;
  if (!has(style["labelStyle.size"])) return null;
  const halo = valueOf(style["labelStyle.halo"]);
  const box = valueOf(style["labelStyle.box"]);
  const backing: Backing | undefined = halo === undefined || box === undefined ? undefined : box ? "box" : halo ? "halo" : "none";
  const weight = valueOf(style["labelStyle.weight"]);
  return (
    <>
      <SliderField
        label={t.text.size}
        value={valueOf(style["labelStyle.size"])}
        min={9}
        max={32}
        step={1}
        format={PIXELS}
        disabled={disabled}
        onChange={(next) => set("labelStyle.size", next)}
        onCommit={commit}
      />
      <Line label={isMixed(style["labelStyle.weight"]) ? `${t.text.weight} · ${t.mixed}` : t.text.weight}>
        <ToggleGroup
          aria-label={t.text.weight}
          size={touch ? "lg" : "sm"}
          spacing={0}
          selectionMode="single"
          disallowEmptySelection={weight !== undefined}
          isDisabled={disabled}
          selectedKeys={weight === undefined ? [] : [String(weight)]}
          onSelectionChange={(keys) => {
            const next = WEIGHTS.find((candidate) => String(candidate) === [...keys][0]);
            if (next !== undefined) set("labelStyle.weight", next);
          }}
        >
          <ToggleGroupItem id="400" className={touch ? "h-11" : undefined}>
            {t.text.regular}
          </ToggleGroupItem>
          <ToggleGroupItem id="600" className={cn("font-semibold", touch && "h-11")}>
            {t.text.bold}
          </ToggleGroupItem>
        </ToggleGroup>
      </Line>
      <Tiles
        label={t.text.backing}
        value={backing}
        mixed={isMixed(style["labelStyle.halo"]) || isMixed(style["labelStyle.box"])}
        disabled={disabled}
        options={BACKINGS.map((id) => ({ id, label: t.text.backings[id], draw: <BackingDraw backing={id} /> }))}
        onChange={(next) => {
          store.restyle({ "labelStyle.halo": next === "halo", "labelStyle.box": next === "box" });
          commit();
        }}
      />
      <ColorControl
        label={t.text.colour}
        value={valueOf(style["labelStyle.color"])}
        mixed={isMixed(style["labelStyle.color"])}
        allowInk
        disabled={disabled}
        onChange={(next) => set("labelStyle.color", next)}
        onCommit={commit}
      />
    </>
  );
}

type Leader = "none" | "straight" | "elbow";
const LEADERS: Leader[] = ["none", "straight", "elbow"];

/** A text annotation: the words, the way they run, how they are set, and the leader back to the anchor. */
export function AnnotationSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const { set, commit } = useRestyle();
  const { style } = summary;
  if (!has(style["annotation.text"])) return null;
  const text = valueOf(style["annotation.text"]);
  const leader = style["annotation.leader"];
  const leaderValue = valueOf(leader);
  const leaderKind: Leader | undefined = leader.state !== "value" ? undefined : leaderValue === null || leaderValue === undefined ? "none" : leaderValue.shape;
  return (
    <Section title={t.text.annotation}>
      <Textarea
        aria-label={t.text.annotation}
        dir={text?.dir ?? "auto"}
        rows={3}
        value={text?.value ?? ""}
        placeholder={text === undefined ? t.mixed : t.text.annotationPlaceholder}
        disabled={disabled}
        onChange={(event) => set("annotation.text", { value: event.target.value, dir: text?.dir ?? "auto" })}
        onBlur={commit}
        className="min-h-16 rounded-field border-rule-strong bg-panel px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3 md:text-sm"
      />
      {text ? <DirectionControl text={text} disabled={disabled} onChange={(dir) => set("annotation.text", { ...text, dir })} /> : null}
      <TextStyleControls summary={summary} disabled={disabled} />
      <Tiles
        label={t.text.leader}
        value={leaderKind}
        mixed={isMixed(leader)}
        disabled={disabled}
        options={LEADERS.map((id) => ({ id, label: t.text.leaders[id], draw: <LeaderDraw leader={id} /> }))}
        onChange={(next) => set("annotation.leader", next === "none" ? null : { shape: next, anchorDot: leaderValue?.anchorDot ?? true })}
      />
      {leaderValue ? (
        <Line label={t.text.anchorDot}>
          <Switch
            aria-label={t.text.anchorDot}
            isSelected={leaderValue.anchorDot}
            isDisabled={disabled}
            onChange={(next) => set("annotation.leader", { ...leaderValue, anchorDot: next })}
          />
        </Line>
      ) : null}
    </Section>
  );
}

/** The optional text drawn on the map with an area, line, arrow, front line or marker. */
export function LabelSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const { touch } = useEditorLayout();
  const { set, commit } = useRestyle();
  const { style } = summary;
  if (!has(style.label)) return null;
  const mixed = isMixed(style.label);
  const label = valueOf(style.label) ?? null;
  return (
    <Section title={t.text.label} aside={mixed ? <Caption className="text-ink-3">{t.mixed}</Caption> : null}>
      <Input
        aria-label={t.text.label}
        dir={label?.dir ?? "auto"}
        value={label?.value ?? ""}
        placeholder={mixed ? t.mixed : t.text.labelPlaceholder}
        disabled={disabled}
        onChange={(event) => set("label", event.target.value === "" ? null : { value: event.target.value, dir: label?.dir ?? "auto" })}
        onBlur={commit}
        className={touch ? "h-11" : undefined}
      />
      {label ? (
        <>
          <DirectionControl text={label} disabled={disabled} onChange={(dir) => set("label", { ...label, dir })} />
          {summary.kinds.includes("annotation") ? null : <TextStyleControls summary={summary} disabled={disabled} />}
        </>
      ) : null}
    </Section>
  );
}
