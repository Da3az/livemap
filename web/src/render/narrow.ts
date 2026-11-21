import { boxesOverlap, type Box } from "./geo";
import type { SceneItem } from "./scene";
import { ANCHOR_DOT_RADIUS, leaderPath, worldWrap, type PlacedText, type ScreenShape } from "./shapes";
import { fontFamilies, layoutText, textBox, type TextBlock } from "./text";
import type { View } from "./view";

/** Below this width the reader's map is phone-sized: notes wrap tighter and give way to each other. */
const NARROW_WIDTH = 480;
/** Text boxes keep this far inside the map frame. */
const EDGE = 6;
/** Two text boxes closer than this count as touching. */
const GAP = 4;
const MIN_MEASURE = 120;
const MAX_MEASURE = 240;

interface Laid {
  item: SceneItem;
  shape: ScreenShape;
}

function grown(box: Box, by: number): Box {
  return { minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by };
}

/** Moves a box's centre the least distance that keeps the whole box inside `[EDGE, size − EDGE]`. */
function clampAxis(centre: number, low: number, high: number, size: number): number {
  const before = centre - low;
  const after = high - centre;
  if (high - low > size - 2 * EDGE) return EDGE + before;
  return Math.max(EDGE + before, Math.min(size - EDGE - after, centre));
}

/**
 * The smallest move that takes `box` clear of `obstacle` and keeps it inside
 * the frame, or null when there is none.
 */
function stepAside(box: Box, obstacle: Box, view: View): { x: number; y: number } | null {
  const moves = [
    { x: obstacle.minX - GAP - box.maxX, y: 0 },
    { x: obstacle.maxX + GAP - box.minX, y: 0 },
    { x: 0, y: obstacle.minY - GAP - box.maxY },
    { x: 0, y: obstacle.maxY + GAP - box.minY },
  ].filter(
    (move) =>
      box.minX + move.x >= EDGE && box.maxX + move.x <= view.width - EDGE && box.minY + move.y >= EDGE && box.maxY + move.y <= view.height - EDGE,
  );
  moves.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));
  return moves[0] ?? null;
}

/**
 * Author-placed notes on the reader's map. An author places notes on a
 * desktop; on a smaller frame they run off the edges, and at 320 to 480 px
 * they also overlap. Every note is pulled inside the frame. On a phone-sized
 * map each note also wraps to a narrower measure, and where two notes still
 * collide the one higher in the draw order stays and the other shrinks to its
 * anchor dot, its text one tap away. A note under the reader's furniture (the
 * key, the zoom buttons) steps the shortest way out from under it.
 */
export class NarrowAnnotations {
  private readonly blocks = new Map<string, { item: SceneItem; measure: number; block: TextBlock | null }>();
  private collapsed = new Set<string>();

  /** True when the note is drawn as its anchor dot only. */
  isCollapsed(id: string): boolean {
    return this.collapsed.has(id);
  }

  /** Rewrites the annotation shapes of one view in place; run before labels are placed. */
  apply(drawn: readonly Laid[], view: View, obstacles: readonly Box[]): void {
    this.collapsed = new Set();
    /* A wide map only keeps notes inside its frame; wrapping tighter and giving way are for phones. */
    const narrow = view.width < NARROW_WIDTH;
    const measure = narrow ? Math.max(MIN_MEASURE, Math.min(MAX_MEASURE, Math.round(view.width * 0.55))) : Infinity;
    const kept: Box[] = [];
    /* Top of the draw order first: what the author put on top wins. */
    for (let index = drawn.length - 1; index >= 0; index--) {
      const entry = drawn[index];
      if (!entry) continue;
      const { item, shape } = entry;
      const { feature, geometry } = item;
      if (shape.kind !== "annotation" || feature.kind !== "annotation" || geometry.kind !== "annotation" || item.text === null) continue;
      const block = this.blockFor(item, measure);
      if (block === null) continue;
      const wanted = view.project(geometry.textAt, worldWrap(item, view));
      const around = textBox(block, wanted);
      const centre = {
        x: clampAxis(wanted.x, around.minX, around.maxX, view.width),
        y: clampAxis(wanted.y, around.minY, around.maxY, view.height),
      };
      for (const obstacle of obstacles) {
        const box = textBox(block, centre);
        if (!boxesOverlap(box, obstacle)) continue;
        const move = stepAside(box, obstacle, view);
        if (move) {
          centre.x += move.x;
          centre.y += move.y;
        }
      }
      const text: PlacedText = { block, centre, box: textBox(block, centre) };
      if (narrow && kept.some((box) => boxesOverlap(grown(text.box, GAP), box))) {
        this.collapsed.add(feature.id);
        shape.text = null;
        shape.leader = null;
        shape.dot = true;
        const reach = ANCHOR_DOT_RADIUS + 3;
        shape.box = { minX: shape.anchor.x - reach, minY: shape.anchor.y - reach, maxX: shape.anchor.x + reach, maxY: shape.anchor.y + reach };
        continue;
      }
      kept.push(text.box);
      shape.text = text;
      shape.leader = feature.leader ? leaderPath(shape.anchor, text, feature.leader.shape) : null;
      shape.box = {
        minX: Math.min(text.box.minX, shape.anchor.x - ANCHOR_DOT_RADIUS),
        minY: Math.min(text.box.minY, shape.anchor.y - ANCHOR_DOT_RADIUS),
        maxX: Math.max(text.box.maxX, shape.anchor.x + ANCHOR_DOT_RADIUS),
        maxY: Math.max(text.box.maxY, shape.anchor.y + ANCHOR_DOT_RADIUS),
      };
    }
  }

  /** The note's text wrapped to `measure`, kept until the note or the measure changes. */
  private blockFor(item: SceneItem, measure: number): TextBlock | null {
    if (item.text !== null && item.text.width <= measure) return item.text;
    const cached = this.blocks.get(item.feature.id);
    if (cached && cached.item === item && cached.measure === measure) return cached.block;
    const block = item.feature.kind === "annotation" ? layoutText(item.feature.text, item.style.text, { family: fontFamilies().ui, align: "start", maxWidth: measure }) : null;
    this.blocks.set(item.feature.id, { item, measure, block });
    return block;
  }
}
