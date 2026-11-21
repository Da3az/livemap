import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countFeatures, KIND_NAMES, selectSelectionSummary, useEditorStore, useEditorStoreApi, type SelectionSummary } from "@/editor/store";
import { useLang } from "@/i18n";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import { PaneHeader } from "../pane";
import { useEditorLayout } from "../shared/layout";
import { useEditorUi } from "../shared/ui";
import { OrderSection, ShapeSection } from "./arrange-section";
import { ColorControl } from "./color-control";
import { isMixed, Section, valueOf } from "./parts";
import { PointSection } from "./point-section";
import { PresetSection } from "./preset-section";
import { ArrowSection, FillSection, FrontlineSection, StrokeSection, useRestyle, type SectionProps } from "./style-sections";
import { AnnotationSection, LabelSection } from "./text-sections";
import { TimeSection } from "./time-section";

/** Why nothing here can be changed, said once, with the way out when there is one. */
function LockedLine({ summary, readOnly }: { summary: SelectionSummary; readOnly: boolean }) {
  const t = useInspectorStrings();
  const store = useEditorStoreApi();
  const groups = useEditorStore((state) => state.doc.settings.groups);
  if (!readOnly && !summary.anyLocked) return null;
  const lockedGroups = new Set(groups.filter((group) => group.locked).map((group) => group.id));
  const covered = summary.features.filter((feature) => feature.locked || (feature.groupId !== null && lockedGroups.has(feature.groupId)));
  const unlock = (): void => {
    const own = covered.filter((feature) => feature.locked).map((feature) => feature.id);
    if (own.length > 0) store.setLocked(false, own);
    for (const groupId of new Set(covered.map((feature) => feature.groupId))) {
      if (groupId !== null && lockedGroups.has(groupId)) store.setGroupLocked(groupId, false);
    }
  };
  return (
    <div role="status" className="flex items-center gap-2 border-b border-rule bg-well px-3 py-2 text-xs text-ink">
      <Icon name="lock" size={14} className="shrink-0 text-state-readonly" />
      <p className="min-w-0 flex-1">{readOnly ? t.locked.readOnly : summary.allLocked ? t.locked.all : t.locked.some(covered.length)}</p>
      {readOnly ? null : (
        <Button variant="outline" size="sm" onPress={unlock}>
          {t.locked.unlock}
        </Button>
      )}
    </div>
  );
}

function GroupSection({ summary, readOnly }: { summary: SelectionSummary; readOnly: boolean }) {
  const t = useInspectorStrings();
  const store = useEditorStoreApi();
  const { touch } = useEditorLayout();
  const group = summary.group;
  if (!group) return null;
  const size = touch ? "touch" : "sm";
  return (
    <Section title={t.group.heading} aside={<span className="tabular-nums">{t.group.count(summary.count)}</span>}>
      <Input
        aria-label={t.group.name}
        dir={group.name.dir}
        value={group.name.value}
        disabled={readOnly}
        onChange={(event) => store.renameGroup(group.id, { ...group.name, value: event.target.value })}
        onBlur={() => store.closeStep()}
        className={touch ? "h-11 font-medium" : "font-medium"}
      />
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size={size} isDisabled={readOnly} onPress={() => store.setGroupHidden(group.id, !group.hidden)}>
          <Icon name={group.hidden ? "eyeOff" : "eye"} size={14} />
          {group.hidden ? t.group.show : t.group.hide}
        </Button>
        <Button variant="outline" size={size} isDisabled={readOnly} onPress={() => store.setGroupLocked(group.id, !group.locked)}>
          <Icon name={group.locked ? "lock" : "unlock"} size={14} />
          {group.locked ? t.group.unlock : t.group.lock}
        </Button>
        <Button variant="outline" size={size} isDisabled={readOnly} onPress={() => store.ungroup(group.id)}>
          {t.group.ungroup}
        </Button>
      </div>
    </Section>
  );
}

/** The feature's name in the list. */
function NameSection({ summary, readOnly }: { summary: SelectionSummary; readOnly: boolean }) {
  const t = useInspectorStrings();
  const store = useEditorStoreApi();
  const { touch } = useEditorLayout();
  const feature = summary.single;
  if (!feature) return null;
  return (
    <label className="flex flex-col gap-1 px-3 pt-2.5">
      <span className="text-xs text-ink-2" title={t.name.hint}>
        {t.name.label}
      </span>
      <Input
        dir={feature.name.dir}
        value={feature.name.value}
        disabled={readOnly}
        onChange={(event) => store.renameFeature(feature.id, { ...feature.name, value: event.target.value })}
        onBlur={() => store.closeStep()}
        className={touch ? "h-11" : undefined}
      />
    </label>
  );
}

/** With several kinds selected: one colour for all of them, whatever part of each it paints. */
function SharedColourSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const { set, commit } = useRestyle();
  if (summary.kinds.length < 2 || summary.style.color.state === "none") return null;
  return (
    <Section title={t.preset.colour}>
      <ColorControl
        label={t.preset.colour}
        value={valueOf(summary.style.color)}
        mixed={isMixed(summary.style.color)}
        disabled={disabled}
        onChange={(next) => {
          if (next !== "ink") set("color", next);
        }}
        onCommit={commit}
      />
    </Section>
  );
}

/**
 * The trailing pane for whatever is selected: one feature, several (shared
 * values shown, differing ones marked mixed, edits applied to all), or a
 * group. Sections appear only for what the selection has.
 */
export function Inspector() {
  const t = useInspectorStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const summary = useEditorStore(selectSelectionSummary);
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const { mode } = useEditorLayout();
  const ui = useEditorUi();

  const close = (): void => {
    if (mode === "tablet") ui.setOverlayPane(null);
    else store.toggleInspector();
  };
  const disabled = readOnly || summary.allLocked;
  const single = summary.single;
  const kind = summary.kinds.length === 1 && summary.kinds[0] ? KIND_NAMES[summary.kinds[0]][lang] : summary.kinds.length > 1 ? t.mixedKinds : "";
  const title = summary.group ? summary.group.name : single ? single.name : null;
  const props: SectionProps = { summary, disabled };

  return (
    <div className="flex h-full min-h-0 flex-col" data-inspector>
      <PaneHeader title={title ? <bdi dir={title.dir}>{title.value}</bdi> : countFeatures(summary.count)[lang]} closeLabel={t.close} onClose={close}>
        <span className="shrink-0 text-xs text-ink-3">{summary.group ? t.group.heading : kind}</span>
      </PaneHeader>
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <LockedLine summary={summary} readOnly={readOnly} />
        <GroupSection summary={summary} readOnly={readOnly} />
        {summary.count > 0 ? (
          <>
            <NameSection summary={summary} readOnly={readOnly} />
            <ShapeSection {...props} />
            <PresetSection {...props} />
            <SharedColourSection {...props} />
            <FillSection {...props} />
            <StrokeSection {...props} />
            <ArrowSection {...props} />
            <FrontlineSection {...props} />
            <PointSection {...props} />
            <AnnotationSection {...props} />
            <LabelSection {...props} />
            <TimeSection {...props} />
            <OrderSection {...props} />
          </>
        ) : null}
      </div>
    </div>
  );
}
