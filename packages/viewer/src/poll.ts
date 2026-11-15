// Polling a pointer object with ETags is the deliberate design, not a
// limitation: there is no WebSocket reader fan-out.

export interface PointerDoc {
  readonly mapId: string;
  readonly version: number;
  readonly etag: string;
  readonly publishedAt: string;
  readonly href: string;
}

export interface PollerOptions {
  /** Absolute or relative URL of `latest.json`. */
  readonly pointerUrl: string;
  readonly intervalMs?: number;
  /** Pause while the tab is hidden. Becoming visible triggers an immediate check. */
  readonly pauseWhenHidden?: boolean;
  /** Called when the pointer reports a version we have not seen. */
  readonly onUpdate: (pointer: PointerDoc) => void | Promise<void>;
  /** Called on network/parse failure. Polling continues regardless. */
  readonly onError?: (error: unknown) => void;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export const LANE_NORMAL_MS = 120_000;
export const LANE_ACTIVE_MS = 10_000;

/** Backoff ceiling, so a dead origin is not hammered. */
const MAX_BACKOFF_MS = 15 * 60_000;

export class UpdatePoller {
  private readonly options: Required<
    Pick<PollerOptions, "intervalMs" | "pauseWhenHidden">
  > &
    PollerOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private destroyed = false;
  private lastEtag: string | null = null;
  private lastVersion = -1;
  private consecutiveFailures = 0;
  /** Guards against overlapping checks if one request outlives its interval. */
  private inFlight = false;

  private readonly onVisibility = () => {
    if (!this.running) return;
    if (typeof document === "undefined") return;
    if (document.hidden) {
      this.clearTimer();
    } else {
      void this.check();
    }
  };

  constructor(options: PollerOptions) {
    this.options = {
      intervalMs: LANE_NORMAL_MS,
      pauseWhenHidden: true,
      ...options,
    };
  }

  start(): void {
    if (this.running || this.destroyed) return;
    this.running = true;
    if (this.options.pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    if (this.options.pauseWhenHidden && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
  }

  /** The version last seen, or -1 before the first successful check. */
  get version(): number {
    return this.lastVersion;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (!this.running || this.destroyed) return;
    if (
      this.options.pauseWhenHidden &&
      typeof document !== "undefined" &&
      document.hidden
    ) {
      return;
    }
    this.timer = setTimeout(() => void this.check(), delayMs);
  }

  /** One poll. Public so a viewer can force a check off-interval. */
  async check(): Promise<void> {
    if (this.destroyed || this.inFlight) return;
    this.inFlight = true;

    const doFetch = this.options.fetchImpl ?? fetch;
    try {
      const headers: Record<string, string> = {
        // Without this a layered cache can hide a new version for its whole TTL.
        "cache-control": "no-cache",
      };
      if (this.lastEtag) headers["if-none-match"] = this.lastEtag;

      const res = await doFetch(this.options.pointerUrl, {
        headers,
        // The pointer is public; an embedded viewer must not leak a cookie to the CDN.
        credentials: "omit",
      });

      if (res.status === 304) {
        this.consecutiveFailures = 0;
        this.schedule(this.options.intervalMs);
        return;
      }

      if (!res.ok) throw new Error(`pointer fetch failed: ${res.status}`);

      const etag = res.headers.get("etag");
      const pointer = (await res.json()) as PointerDoc;

      this.consecutiveFailures = 0;
      if (etag) this.lastEtag = etag;

      // Trigger on version, not ETag: a republish of identical content keeps the
      // same ETag, and re-rendering an identical map would flicker the view.
      if (pointer.version > this.lastVersion) {
        this.lastVersion = pointer.version;
        await this.options.onUpdate(pointer);
      }

      this.schedule(this.options.intervalMs);
    } catch (err) {
      this.consecutiveFailures++;
      this.options.onError?.(err);
      const backoff = Math.min(
        this.options.intervalMs * 2 ** this.consecutiveFailures,
        MAX_BACKOFF_MS,
      );
      this.schedule(backoff);
    } finally {
      this.inFlight = false;
    }
  }
}
