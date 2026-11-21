import { alongPolyline, boxesOverlap, pointInRings, polylineLength, ringCentroid, type Box, type Pt } from "./geo";
import type { ScreenShape } from "./shapes";
import { textBox, type TextBlock } from "./text";

/**
 * De-confliction for the text the renderer draws.
 *
 * Every label has a short list of places it may sit, best first: around a
 * point's disc, along a path, inside an area. Labels are placed in priority
 * order (selected features, then the rest from the top of the draw order
 * down) against what is already there: annotation boxes, which never move
 * because their author placed them, point discs, and the labels placed so
 * far. A label that fits nowhere is not drawn.
 *
 * The answer for one label is the index of the place it took. Indices are
 * kept per zoom bucket and reused for every frame inside it, so panning never
 * re-decides anything, and when a bucket is recomputed each label tries the
 * place it had first. That is the whole of the hysteresis: a label moves only
 * when its old place is taken.
 *
 * Map furniture laid over the map (the title block, the key, the zoom
 * buttons) is an obstacle too. It is fixed to the screen while labels move
 * with the map, so besides taking part in each decision it is checked on
 * every frame: a label the furniture now covers takes another free place for
 * as long as it is covered, without changing what was decided for it.
 */

export const LABEL_HIDDEN = -1;

const POINT_GAP = 4;
const PATH_GAP = 3;
/** Clear space kept around a placed label, so a quarter-step of zoom inside a bucket does not bring two together. */
const CLEARANCE = 3;
const PATH_FRACTIONS = [0.5, 0.35, 0.65, 0.22, 0.78] as const;
const CELL = 96;

function boxAround(centre: Pt, radius: number): Box {
  return { minX: centre.x - radius, minY: centre.y - radius, maxX: centre.x + radius, maxY: centre.y + radius };
}

function pathOf(shape: ScreenShape): readonly Pt[] | null {
  if (shape.kind === "line" || shape.kind === "frontline") return shape.points;
  if (shape.kind === "arrow") return shape.shaft;
  return null;
}

/** How far a path's label stands off the line when it is placed beside it. */
function pathClearance(shape: ScreenShape, strokeWidth: number): number {
  return strokeWidth / 2 + PATH_GAP + (shape.kind === "frontline" ? 6 : 0);
}

/** How many places a label of this shape may try. */
export function candidateCount(shape: ScreenShape): number {
  if (shape.kind === "point") return 8;
  if (shape.kind === "area") return 7;
  if (shape.kind === "annotation") return 1;
  return PATH_FRACTIONS.length + 2;
}

/**
 * The centre of a label in its `index`-th place, or null when the shape has
 * no such place (an area too small to hold the text off its centre). Index 0
 * always exists and is where an unconflicted label sits.
 */
export function candidateCentre(shape: ScreenShape, block: TextBlock, index: number, strokeWidth: number): Pt | null {
  const halfW = block.width / 2;
  const halfH = block.height / 2;
  if (shape.kind === "point") {
    const { centre, radius } = shape;
    const down = radius + POINT_GAP + halfH;
    const side = radius + POINT_GAP + halfW + 2;
    const diagonalX = radius * 0.7 + POINT_GAP + halfW;
    const diagonalY = radius * 0.7 + POINT_GAP + halfH;
    const offsets: Pt[] = [
      { x: 0, y: down },
      { x: 0, y: -down },
      { x: side, y: 0 },
      { x: -side, y: 0 },
      { x: diagonalX, y: diagonalY },
      { x: -diagonalX, y: diagonalY },
      { x: diagonalX, y: -diagonalY },
      { x: -diagonalX, y: -diagonalY },
    ];
    const offset = offsets[index];
    return offset ? { x: centre.x + offset.x, y: centre.y + offset.y } : null;
  }
  if (shape.kind === "area") {
    const outer = shape.rings[0];
    const centroid = outer ? ringCentroid(outer) : null;
    if (!centroid) return null;
    if (index === 0) return centroid;
    const stepY = block.height + 4;
    const stepX = halfW + 8;
    const offsets: Pt[] = [
      { x: 0, y: -stepY },
      { x: 0, y: stepY },
      { x: stepX, y: 0 },
      { x: -stepX, y: 0 },
      { x: 0, y: -stepY * 2 },
      { x: 0, y: stepY * 2 },
    ];
    const offset = offsets[index - 1];
    if (!offset) return null;
    const at = { x: centroid.x + offset.x, y: centroid.y + offset.y };
    /* A label that leaves its area names the wrong ground. */
    return pointInRings(at, shape.rings) ? at : null;
  }
  const path = pathOf(shape);
  if (!path) return shape.text?.centre ?? null;
  const total = polylineLength(path);
  const fraction = PATH_FRACTIONS[index];
  if (fraction !== undefined) return alongPolyline(path, total * fraction)?.at ?? path[0] ?? null;
  /* Beside the middle of the line, on one side then the other. */
  const middle = alongPolyline(path, total / 2);
  if (!middle) return null;
  const side = index === PATH_FRACTIONS.length ? 1 : -1;
  const away = pathClearance(shape, strokeWidth) + halfH;
  /* Mostly vertical travel puts the text beside the line; otherwise above or below it. */
  const steep = Math.abs(middle.dir.y) > Math.abs(middle.dir.x);
  return steep ? { x: middle.at.x + side * (away - halfH + halfW + 2), y: middle.at.y } : { x: middle.at.x, y: middle.at.y - side * away };
}

/** A uniform grid over screen space; boxes are few and small, so a cell holds a handful. */
class BoxIndex {
  private readonly cells = new Map<number, { box: Box; owner: string }[]>();

  private *keys(box: Box): Generator<number> {
    const x0 = Math.floor(box.minX / CELL);
    const x1 = Math.floor(box.maxX / CELL);
    const y0 = Math.floor(box.minY / CELL);
    const y1 = Math.floor(box.maxY / CELL);
    /* An absurdly large box (a label at an extreme zoom) is not worth indexing cell by cell. */
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) yield x * 73_856_093 + y * 19_349_663;
  }

  add(box: Box, owner: string): void {
    for (const key of this.keys(box)) {
      const cell = this.cells.get(key);
      if (cell) cell.push({ box, owner });
      else this.cells.set(key, [{ box, owner }]);
    }
  }

  /** True when the box overlaps anything that belongs to another feature. */
  collides(box: Box, owner: string): boolean {
    for (const key of this.keys(box)) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      for (const entry of cell) {
        if (entry.owner === owner) continue;
        const other = entry.box;
        if (box.minX < other.maxX && box.maxX > other.minX && box.minY < other.maxY && box.maxY > other.minY) return true;
      }
    }
    return false;
  }
}

export interface LabelEntry {
  id: string;
  shape: ScreenShape;
  /** The text to place: a feature's label, or an annotation's own text. */
  block: TextBlock | null;
  strokeWidth: number;
}

const FURNITURE = "\u0000furniture";

function grown(box: Box, by: number): Box {
  return { minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by };
}

export class LabelPlacer {
  private choices = new Map<string, number>();
  private key = "";
  /** Places to try first: what an earlier layout, or the screen an export was made from, had chosen. */
  private hints: ReadonlyMap<string, number> | null;
  /** Take the hints as the answer instead of a preference (an export at the screen's own scale). */
  private readonly pinned: boolean;
  /** Screen rectangles covered by furniture, in CSS pixels from the map's top-left corner. */
  private obstacles: readonly Box[] = [];

  constructor(hints: ReadonlyMap<string, number> | null = null, options: { pinned?: boolean } = {}) {
    this.hints = hints;
    this.pinned = options.pinned === true && hints !== null;
  }

  /** The place each label took, by feature id. `LABEL_HIDDEN` for a label that is not drawn. */
  snapshot(): ReadonlyMap<string, number> {
    return this.choices;
  }

  /** Replaces the furniture rectangles. The next `apply` decides again. */
  setObstacles(obstacles: readonly Box[]): void {
    this.obstacles = obstacles;
    this.key = "";
  }

  /**
   * Places every label in `entries` (ascending draw order) and writes the
   * result onto the shapes. `key` names everything a decision depends on
   * apart from panning; while it is unchanged the stored decisions are reused.
   */
  apply(entries: readonly LabelEntry[], key: string, priority: ReadonlySet<string>): void {
    if (key !== this.key) {
      this.decide(entries, priority);
      this.key = key;
    }
    const covered = this.obstacles.length > 0 ? this.avoidFurniture(entries, priority) : null;
    for (const entry of entries) {
      const { shape, block } = entry;
      if (shape.kind === "annotation" || !block) continue;
      const choice = covered?.get(entry.id) ?? this.choices.get(entry.id) ?? 0;
      if (choice === LABEL_HIDDEN) {
        shape.labelHidden = true;
        continue;
      }
      const centre = candidateCentre(shape, block, choice, entry.strokeWidth) ?? candidateCentre(shape, block, 0, entry.strokeWidth);
      shape.labelHidden = false;
      if (!centre) continue;
      const box = textBox(block, centre);
      shape.text = { block, centre, box };
      if (box.minX < shape.box.minX) shape.box.minX = box.minX;
      if (box.minY < shape.box.minY) shape.box.minY = box.minY;
      if (box.maxX > shape.box.maxX) shape.box.maxX = box.maxX;
      if (box.maxY > shape.box.maxY) shape.box.maxY = box.maxY;
    }
  }

  /** Where a label sits with its decided place, or null when it is not drawn. */
  private decidedBox(entry: LabelEntry): Box | null {
    const { shape, block } = entry;
    if (shape.kind === "annotation" || !block) return null;
    const choice = this.choices.get(entry.id) ?? 0;
    if (choice === LABEL_HIDDEN) return null;
    const centre = candidateCentre(shape, block, choice, entry.strokeWidth) ?? candidateCentre(shape, block, 0, entry.strokeWidth);
    return centre ? textBox(block, centre) : null;
  }

  /**
   * For this frame only: the labels the furniture covers, each with another
   * free place or `LABEL_HIDDEN`. The selection keeps its place under the
   * furniture, as it does against everything else.
   */
  private avoidFurniture(entries: readonly LabelEntry[], priority: ReadonlySet<string>): Map<string, number> | null {
    const boxes = new Map<string, Box>();
    const clashing: LabelEntry[] = [];
    for (const entry of entries) {
      const box = this.decidedBox(entry);
      if (!box) continue;
      boxes.set(entry.id, box);
      if (!priority.has(entry.id) && this.obstacles.some((obstacle) => boxesOverlap(box, obstacle))) clashing.push(entry);
    }
    if (clashing.length === 0) return null;

    const index = new BoxIndex();
    for (const obstacle of this.obstacles) index.add(obstacle, FURNITURE);
    for (const { id, shape } of entries) {
      if (shape.kind === "annotation" && shape.text) index.add(shape.text.box, id);
      if (shape.kind === "point") index.add(boxAround(shape.centre, shape.radius + 1), id);
    }
    const moving = new Set(clashing.map((entry) => entry.id));
    for (const [id, box] of boxes) if (!moving.has(id)) index.add(grown(box, CLEARANCE), id);

    const out = new Map<string, number>();
    /* Top of the draw order first, as in a decision. */
    for (const entry of [...clashing].reverse()) {
      const { id, shape, block } = entry;
      if (!block) continue;
      let chosen = LABEL_HIDDEN;
      for (let candidate = 0; candidate < candidateCount(shape); candidate++) {
        const centre = candidateCentre(shape, block, candidate, entry.strokeWidth);
        if (!centre) continue;
        const box = grown(textBox(block, centre), CLEARANCE);
        if (index.collides(box, id)) continue;
        index.add(box, id);
        chosen = candidate;
        break;
      }
      out.set(id, chosen);
    }
    return out;
  }

  private decide(entries: readonly LabelEntry[], priority: ReadonlySet<string>): void {
    if (this.pinned && this.hints) {
      /* Labels the screen never placed (none, at the screen's scale) are placed where they would sit unconflicted. */
      this.choices = new Map(entries.map((entry) => [entry.id, this.hints?.get(entry.id) ?? 0]));
      return;
    }
    const index = new BoxIndex();
    const previous = this.choices.size > 0 ? this.choices : this.hints;
    const next = new Map<string, number>();

    /* What labels must yield to: the furniture, annotation boxes where their authors put them, and every disc. */
    for (const obstacle of this.obstacles) index.add(obstacle, FURNITURE);
    for (const { id, shape } of entries) {
      if (shape.kind === "annotation" && shape.text) index.add(shape.text.box, id);
      if (shape.kind === "point") index.add(boxAround(shape.centre, shape.radius + 1), id);
    }

    const labelled = entries.filter((entry) => entry.block !== null && entry.shape.kind !== "annotation");
    /* Top of the draw order first; the selection ahead of everything. */
    const ordered = [...labelled.filter((entry) => priority.has(entry.id)).reverse(), ...labelled.filter((entry) => !priority.has(entry.id)).reverse()];

    for (const entry of ordered) {
      const { id, shape, block } = entry;
      if (!block) continue;
      const count = candidateCount(shape);
      const was = previous?.get(id);
      const order = was !== undefined && was >= 0 && was < count ? [was, ...Array.from({ length: count }, (_, i) => i).filter((i) => i !== was)] : Array.from({ length: count }, (_, i) => i);
      let chosen = LABEL_HIDDEN;
      for (const candidate of order) {
        const centre = candidateCentre(shape, block, candidate, entry.strokeWidth);
        if (!centre) continue;
        const box = grown(textBox(block, centre), CLEARANCE);
        if (index.collides(box, id)) continue;
        index.add(box, id);
        chosen = candidate;
        break;
      }
      /* The feature in hand always shows its label: its author is looking at it. */
      if (chosen === LABEL_HIDDEN && priority.has(id)) {
        chosen = order[0] ?? 0;
        const centre = candidateCentre(shape, block, chosen, entry.strokeWidth);
        if (centre) index.add(grown(textBox(block, centre), CLEARANCE), id);
      }
      next.set(id, chosen);
    }
    this.choices = next;
  }
}

/** The zoom, turn and tilt a set of decisions holds for. Panning is deliberately absent. */
export function labelBucket(zoom: number, bearing: number, pitch: number): string {
  return `${Math.round(zoom * 4)}|${Math.round(bearing / 10)}|${Math.round(pitch / 10)}`;
}
