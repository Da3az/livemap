import { cn } from "cn";
import { memo } from "react";
import { Button } from "react-aria-components";
import { Icon, type IconName } from "@/components/icons";
import { useEditorStoreApi, type FeatureRow, type GroupRow } from "@/editor/store";
import { useLang } from "@/i18n";
import { useListStrings } from "@/i18n/editor-list";
import { KindChip } from "./kind-chip";
import { formatValidity, formatValidityFull } from "./model";

export interface RowFlags {
  isSelected: boolean;
  isFocusVisible: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  touch: boolean;
  readOnly: boolean;
}

const ICON_BUTTON =
  "shrink-0 items-center justify-center rounded-field text-ink-3 outline-none hover:bg-rule hover:text-ink data-focus-visible:outline-2 data-focus-visible:outline-focus data-pressed:bg-rule-strong data-disabled:opacity-50";

/** Hide or lock, on a row. Shown on hover and focus; always shown while it is on, on the selected row, and on touch. */
function RowToggle({
  icon,
  label,
  on,
  inherited,
  always,
  flags,
  onPress,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  /** The row's group is hidden or locked, so the row is too whatever its own flag says. */
  inherited: boolean;
  always: boolean;
  flags: RowFlags;
  onPress: () => void;
}) {
  const shown = on || inherited || always;
  return (
    <Button
      aria-label={label}
      aria-pressed={on}
      isDisabled={flags.readOnly}
      onPress={onPress}
      excludeFromTabOrder
      className={cn(
        ICON_BUTTON,
        flags.touch ? "size-11" : "size-6",
        shown ? "flex" : "hidden group-hover/row:flex group-focus-within/row:flex",
        on ? "text-ink" : inherited ? "text-ink-3" : null,
      )}
    >
      <Icon name={icon} />
    </Button>
  );
}

/**
 * The keyboard's way into drag and drop: move to it with the arrow keys and
 * press Enter. Pointer users drag the row itself, so it only shows on focus.
 */
function DragHandle({ label, flags }: { label: string; flags: RowFlags }) {
  if (flags.readOnly) return null;
  return (
    <Button
      slot="drag"
      aria-label={label}
      excludeFromTabOrder
      className="pointer-events-none absolute inset-y-1 start-0.5 z-10 flex w-5 items-center justify-center rounded-field bg-panel text-ink-2 opacity-0 outline-none data-focus-visible:opacity-100 data-focus-visible:outline-2 data-focus-visible:outline-focus"
    >
      <Icon name="grip" size={12} />
    </Button>
  );
}

function MoreButton({ label, flags, onPress }: { label: string; flags: RowFlags; onPress: (anchor: Element) => void }) {
  if (!flags.touch || !flags.isSelected) return null;
  return (
    <Button aria-label={label} excludeFromTabOrder onPress={(event) => onPress(event.target)} className={cn(ICON_BUTTON, "flex size-11")}>
      <Icon name="more" />
    </Button>
  );
}

function rowShell(flags: RowFlags, extra?: string): string {
  return cn(
    "group/row relative flex h-full min-w-0 items-center gap-2 rounded-block pe-1 text-sm",
    flags.isSelected ? "bg-survey/10 ring-1 ring-survey ring-inset" : "hover:bg-well",
    flags.isDropTarget && "bg-plum/10 ring-2 ring-plum ring-inset",
    flags.isFocusVisible && "outline-2 -outline-offset-2 outline-focus",
    flags.isDragging && "opacity-50",
    extra,
  );
}

export const FeatureRowContent = memo(function FeatureRowContent({
  row,
  flags,
  inSelectedGroup,
  onMore,
}: {
  row: FeatureRow;
  flags: RowFlags;
  /** Its group row is what is selected: the feature is part of the selection without being the selected row. */
  inSelectedGroup: boolean;
  onMore: (key: string, anchor: Element) => void;
}) {
  const t = useListStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const dates = formatValidity(row.validFrom, row.validTo, lang, t);
  const groupHidden = row.effectiveHidden && !row.hidden;
  const groupLocked = row.effectiveLocked && !row.locked;

  return (
    <div data-row-id={row.id} className={rowShell(flags, cn(row.groupId === null ? "ps-2" : "ps-6", inSelectedGroup && !flags.isSelected && "bg-well"))}>
      <DragHandle label={t.dragHandle} flags={flags} />
      <span className={cn("flex shrink-0", row.effectiveHidden && "opacity-40")}>
        <KindChip swatch={row.swatch} />
      </span>
      <span
        dir={row.name.dir}
        data-row-name
        className={cn("min-w-0 flex-1 truncate text-start", flags.isSelected && "font-medium", row.effectiveHidden ? "text-ink-3" : "text-ink")}
      >
        {row.name.value}
      </span>
      {dates !== null && !(flags.touch && flags.isSelected) ? (
        <span title={formatValidityFull(row.validFrom, row.validTo, lang, t)} className="shrink-0 text-2xs whitespace-nowrap text-ink-3 tabular-nums">
          {dates}
        </span>
      ) : null}
      <span className="flex shrink-0 items-center">
        <RowToggle
          icon={row.effectiveHidden ? "eyeOff" : "eye"}
          label={groupHidden ? t.hiddenByGroup : row.hidden ? t.show : t.hide}
          on={row.hidden}
          inherited={groupHidden}
          always={flags.isSelected}
          flags={flags}
          onPress={() => store.setHidden(!row.hidden, [row.id])}
        />
        <RowToggle
          icon={row.effectiveLocked ? "lock" : "unlock"}
          label={groupLocked ? t.lockedByGroup : row.locked ? t.unlock : t.lock}
          on={row.locked}
          inherited={groupLocked}
          always={flags.isSelected}
          flags={flags}
          onPress={() => store.setLocked(!row.locked, [row.id])}
        />
        <MoreButton label={t.more} flags={flags} onPress={(anchor) => onMore(row.id, anchor)} />
      </span>
    </div>
  );
});

export const GroupRowContent = memo(function GroupRowContent({
  group,
  rowKey,
  isExpanded,
  flags,
  onMore,
}: {
  group: GroupRow;
  rowKey: string;
  isExpanded: boolean;
  flags: RowFlags;
  onMore: (key: string, anchor: Element) => void;
}) {
  const t = useListStrings();
  const store = useEditorStoreApi();
  const count = group.features.length;

  return (
    <div data-row-id={rowKey} className={rowShell(flags, "ps-0.5")}>
      <DragHandle label={t.dragHandle} flags={flags} />
      <Button
        slot="chevron"
        aria-label={isExpanded ? t.collapse : t.expand}
        excludeFromTabOrder
        className={cn(ICON_BUTTON, "flex text-plum", flags.touch ? "size-11" : "size-5")}
      >
        <Icon name="chevron" size={12} className={cn("transition-transform duration-100", isExpanded ? "rotate-90" : "rtl:-scale-x-100")} />
      </Button>
      <span
        dir={group.name.dir}
        data-row-name
        className={cn("min-w-0 truncate text-start font-semibold", group.hidden ? "text-ink-3" : "text-plum")}
      >
        {group.name.value}
      </span>
      <span title={t.groupCount(count)} className="min-w-0 flex-1 text-2xs text-ink-3 tabular-nums">
        {count === 0 ? t.emptyGroup : count}
      </span>
      <span className="flex shrink-0 items-center">
        <RowToggle
          icon={group.hidden ? "eyeOff" : "eye"}
          label={group.hidden ? t.show : t.hide}
          on={group.hidden}
          inherited={false}
          always={flags.isSelected}
          flags={flags}
          onPress={() => store.setGroupHidden(group.id, !group.hidden)}
        />
        <RowToggle
          icon={group.locked ? "lock" : "unlock"}
          label={group.locked ? t.unlock : t.lock}
          on={group.locked}
          inherited={false}
          always={flags.isSelected}
          flags={flags}
          onPress={() => store.setGroupLocked(group.id, !group.locked)}
        />
        <MoreButton label={t.more} flags={flags} onPress={(anchor) => onMore(rowKey, anchor)} />
      </span>
    </div>
  );
});
