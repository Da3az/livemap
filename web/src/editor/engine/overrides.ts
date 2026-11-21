import type { MapFeature } from "@/model/types";

/** How long a committed gesture stays on screen waiting for the store to hand the document back. */
const ECHO_TIMEOUT_MS = 600;

/**
 * Work in progress shown in place of the document's features. Never a second
 * copy of truth: committed features stay on screen only until the store calls
 * `setFeatures` back, so nothing jumps to the old state in between. A store
 * that refuses the change never calls back; the timer then drops them and the
 * map shows the document again.
 */
export class Overrides {
  private shown = new Map<string, MapFeature>();
  private awaitingEcho = false;
  private timer = 0;

  constructor(private readonly onChange: (features: readonly MapFeature[]) => void) {}

  get(id: string): MapFeature | undefined {
    return this.shown.get(id);
  }

  /** A gesture in flight. */
  show(features: readonly MapFeature[]): void {
    window.clearTimeout(this.timer);
    this.awaitingEcho = false;
    this.shown = new Map(features.map((feature) => [feature.id, feature]));
    this.onChange(features);
  }

  /** A gesture's end: kept until the store answers, or until the timeout. */
  hold(features: readonly MapFeature[]): void {
    this.show(features);
    this.awaitingEcho = true;
    this.timer = window.setTimeout(() => this.clear(), ECHO_TIMEOUT_MS);
  }

  /** The store handed the document back. */
  echoed(): void {
    if (this.awaitingEcho) this.clear();
  }

  clear(): void {
    window.clearTimeout(this.timer);
    this.awaitingEcho = false;
    if (this.shown.size === 0) return;
    this.shown = new Map();
    this.onChange([]);
  }
}
