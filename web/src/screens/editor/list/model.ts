import type { EditorStore, FeatureRow, GroupRow, ListTree } from "@/editor/store";
import { LOCALE, type Lang } from "@/i18n";
import type { ListStrings } from "@/i18n/editor-list";

/** One row of the tree. Features are keyed by their id; groups by `g:` + id, so the two never collide. */
export interface FeatureNode {
  id: string;
  type: "feature";
  row: FeatureRow;
}
export interface GroupNode {
  id: string;
  type: "group";
  group: GroupRow;
  children: FeatureNode[];
}
export type ListNode = GroupNode | FeatureNode;

const GROUP_PREFIX = "g:";

export function groupKey(groupId: string): string {
  return GROUP_PREFIX + groupId;
}
export function isGroupKey(key: string): boolean {
  return key.startsWith(GROUP_PREFIX);
}
export function groupIdOf(key: string): string {
  return key.slice(GROUP_PREFIX.length);
}

const featureNodes = new WeakMap<FeatureRow, FeatureNode>();
function featureNode(row: FeatureRow): FeatureNode {
  let node = featureNodes.get(row);
  if (!node) {
    node = { id: row.id, type: "feature", row };
    featureNodes.set(row, node);
  }
  return node;
}

const groupNodes = new WeakMap<GroupRow, GroupNode>();
function groupNode(group: GroupRow): GroupNode {
  let node = groupNodes.get(group);
  if (!node) {
    node = { id: groupKey(group.id), type: "group", group, children: group.features.map(featureNode) };
    groupNodes.set(group, node);
  }
  return node;
}

/** The tree as rows: groups first, then the features in no group. Nodes keep their identity while their row does. */
export function buildNodes(tree: ListTree): ListNode[] {
  return [...tree.groups.map(groupNode), ...tree.ungrouped.map(featureNode)];
}

/** Every row that is on screen when nothing is scrolled away, in reading order. */
export function visibleKeys(tree: ListTree): string[] {
  const keys: string[] = [];
  for (const group of tree.groups) {
    keys.push(groupKey(group.id));
    if (!group.collapsed) for (const row of group.features) keys.push(row.id);
  }
  for (const row of tree.ungrouped) keys.push(row.id);
  return keys;
}

/* ------------------------------------------------------------------ dates */

/* Building an Intl formatter costs far more than using one, and every visible row formats dates on every render. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(lang: Lang, kind: "short" | "full"): Intl.DateTimeFormat {
  const key = `${lang}:${kind}`;
  let format = formatters.get(key);
  if (!format) {
    format =
      kind === "short"
        ? new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short" })
        : new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    formatters.set(key, format);
  }
  return format;
}

/** "3–4 Oct", "3 Oct", "from 3 Oct", "until 4 Oct"; null when the feature has no dates. */
export function formatValidity(from: string | null, to: string | null, lang: Lang, t: ListStrings): string | null {
  if (from === null && to === null) return null;
  const format = formatter(lang, "short");
  if (from !== null && to !== null) {
    const start = new Date(from);
    const end = new Date(to);
    return start.toDateString() === end.toDateString() ? format.format(start) : format.formatRange(start, end);
  }
  if (from !== null) return t.from(format.format(new Date(from)));
  return t.until(format.format(new Date(to ?? "")));
}

/** The exact times, for the tooltip of the compact range. */
export function formatValidityFull(from: string | null, to: string | null, lang: Lang, t: ListStrings): string {
  const format = formatter(lang, "full");
  if (from !== null && to !== null) return format.formatRange(new Date(from), new Date(to));
  if (from !== null) return t.from(format.format(new Date(from)));
  return to === null ? "" : t.until(format.format(new Date(to)));
}

/* ------------------------------------------------------------------ drops */

export interface RowDrop {
  /** The row the dragged rows were dropped at. */
  key: string;
  position: "before" | "after" | "on";
}

/** What is being dragged, reduced to one group or a set of features: a group never travels with loose features. */
export function normaliseDrag(keys: Iterable<string>): { group: string } | { features: string[] } {
  const all = [...keys];
  const group = all.find(isGroupKey);
  return group !== undefined ? { group: groupIdOf(group) } : { features: all };
}

/**
 * Where a dragged group lands for a drop at `drop`. Besides the edges of
 * another group's row, the end of a group's features and the start of the
 * loose features both mean "after that group".
 */
function groupDropTarget(tree: ListTree, groupId: string, drop: RowDrop): { relativeTo: string; side: "before" | "after" } | null {
  if (drop.position === "on") return null;
  let target: { relativeTo: string; side: "before" | "after" } | null = null;
  if (isGroupKey(drop.key)) {
    target = { relativeTo: groupIdOf(drop.key), side: drop.position };
  } else {
    const owner = tree.groups.find((group) => group.features.some((row) => row.id === drop.key));
    const last = tree.groups[tree.groups.length - 1];
    if (owner && drop.position === "after" && owner.features[owner.features.length - 1]?.id === drop.key) {
      target = { relativeTo: owner.id, side: "after" };
    } else if (!owner && last && drop.position === "before" && tree.ungrouped[0]?.id === drop.key) {
      target = { relativeTo: last.id, side: "after" };
    }
  }
  return target !== null && target.relativeTo !== groupId ? target : null;
}

/** Whether a drop makes sense, before it is offered as a target. */
export function canDrop(tree: ListTree, drag: ReturnType<typeof normaliseDrag>, drop: RowDrop): boolean {
  if ("group" in drag) return groupDropTarget(tree, drag.group, drop) !== null;
  if (isGroupKey(drop.key)) return true;
  return drop.position !== "on" && !drag.features.includes(drop.key);
}

/**
 * The group whose last row `drop` falls under, if any. The line under a
 * group's last row is the gap between that group and whatever follows, so a
 * drop there takes the rows out of the group instead of adding them to it.
 * (The tree only offers "after the group" at that spot when the pointer
 * moves sideways, which nobody discovers.)
 */
export function gapAfterGroup(tree: ListTree, drop: RowDrop): string | null {
  if (drop.position !== "after" || isGroupKey(drop.key)) return null;
  const owner = tree.groups.find((group) => group.features[group.features.length - 1]?.id === drop.key);
  return owner?.id ?? null;
}

/**
 * Carry out a drop. Rows read top-first, so "before row X" draws over X.
 * Dropping on a group puts the rows at its top; dropping between groups takes
 * them out of every group.
 */
export function applyDrop(store: EditorStore, tree: ListTree, drag: ReturnType<typeof normaliseDrag>, drop: RowDrop): void {
  if (!canDrop(tree, drag, drop)) return;
  if ("group" in drag) {
    const target = groupDropTarget(tree, drag.group, drop);
    if (target !== null) store.moveGroup(drag.group, target);
    return;
  }
  const ids = tree.flatIds.filter((id) => drag.features.includes(id));
  if (gapAfterGroup(tree, drop) !== null) {
    store.moveFeatures(ids, { relativeTo: drop.key, side: "below" }, { groupId: null });
    return;
  }
  if (!isGroupKey(drop.key)) {
    store.moveFeatures(ids, { relativeTo: drop.key, side: drop.position === "before" ? "above" : "below" });
    return;
  }
  const groupId = groupIdOf(drop.key);
  if (drop.position === "on") {
    const first = tree.groups.find((group) => group.id === groupId)?.features.find((row) => !ids.includes(row.id));
    if (first) store.moveFeatures(ids, { relativeTo: first.id, side: "above" }, { groupId });
    else store.moveToGroup(groupId, ids);
    return;
  }
  /* Between two groups there is no place in the draw order, only "not in a group". */
  const lastGroup = tree.groups[tree.groups.length - 1];
  const firstLoose = tree.ungrouped.find((row) => !ids.includes(row.id));
  if (drop.position === "after" && lastGroup?.id === groupId && firstLoose) {
    store.moveFeatures(ids, { relativeTo: firstLoose.id, side: "above" }, { groupId: null });
  } else {
    store.moveToGroup(null, ids);
  }
}

/** Move a group one place up or down among the groups. Returns false at the end of the list. */
export function stepGroup(store: EditorStore, tree: ListTree, groupId: string, direction: -1 | 1): boolean {
  const index = tree.groups.findIndex((group) => group.id === groupId);
  const neighbour = tree.groups[index + direction];
  if (index < 0 || !neighbour) return false;
  store.moveGroup(groupId, { relativeTo: neighbour.id, side: direction === -1 ? "before" : "after" });
  return true;
}
