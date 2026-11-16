import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * WebSocket fan-out for published map versions.
 *
 * This is the design `claude-plans/decisions.md` rejected for reader delivery,
 * implemented so the rejection rests on measurements rather than on citations
 * (see loadtest/). It is written to be competent, not a strawman: the payload
 * is serialised once per broadcast rather than per subscriber, dead sockets are
 * reaped by heartbeat, and a subscriber that cannot keep up is dropped instead
 * of being allowed to grow an unbounded send buffer.
 *
 * The cost it cannot engineer away is structural. Every reader is a connection
 * the origin must hold for the whole session, so capacity scales with
 * concurrent readers rather than with the rate of change, and a CDN cannot
 * absorb any of it.
 */

export interface RealtimeOptions {
  readonly heartbeatMs?: number;
  /** Drop a subscriber whose outbound buffer exceeds this. */
  readonly maxBufferedBytes?: number;
}

interface Subscriber {
  readonly socket: WebSocket;
  readonly mapId: string;
  alive: boolean;
}

export class RealtimeHub {
  private readonly wss: WebSocketServer;
  private readonly byMap = new Map<string, Set<Subscriber>>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly maxBuffered: number;

  private broadcasts = 0;
  private framesSent = 0;
  private dropped = 0;

  constructor(server: Server, opts: RealtimeOptions = {}) {
    this.maxBuffered = opts.maxBufferedBytes ?? 1_000_000;
    this.wss = new WebSocketServer({ server, path: "/live" });

    this.wss.on("connection", (socket, req) => {
      const mapId = new URL(req.url ?? "/", "http://localhost").searchParams.get(
        "map",
      );
      if (!mapId) {
        socket.close(1008, "map required");
        return;
      }

      const sub: Subscriber = { socket, mapId, alive: true };
      let set = this.byMap.get(mapId);
      if (!set) {
        set = new Set();
        this.byMap.set(mapId, set);
      }
      set.add(sub);

      socket.on("pong", () => {
        sub.alive = true;
      });
      socket.on("close", () => this.remove(sub));
      socket.on("error", () => this.remove(sub));
    });

    // Without this, a client that vanishes without a close frame stays in the
    // subscriber set and its memory is never reclaimed.
    this.heartbeat = setInterval(() => {
      for (const set of this.byMap.values()) {
        for (const sub of set) {
          if (!sub.alive) {
            sub.socket.terminate();
            this.remove(sub);
            continue;
          }
          sub.alive = false;
          sub.socket.ping();
        }
      }
    }, opts.heartbeatMs ?? 30_000);
    this.heartbeat.unref();
  }

  private remove(sub: Subscriber): void {
    const set = this.byMap.get(sub.mapId);
    if (!set) return;
    set.delete(sub);
    if (set.size === 0) this.byMap.delete(sub.mapId);
  }

  /** Serialised once, then written to every subscriber of that map. */
  broadcast(mapId: string, payload: unknown): void {
    const set = this.byMap.get(mapId);
    if (!set || set.size === 0) return;

    const frame = JSON.stringify(payload);
    this.broadcasts++;

    for (const sub of set) {
      if (sub.socket.readyState !== sub.socket.OPEN) {
        this.remove(sub);
        continue;
      }
      if (sub.socket.bufferedAmount > this.maxBuffered) {
        this.dropped++;
        sub.socket.terminate();
        this.remove(sub);
        continue;
      }
      sub.socket.send(frame);
      this.framesSent++;
    }
  }

  get stats(): {
    connections: number;
    maps: number;
    broadcasts: number;
    framesSent: number;
    dropped: number;
  } {
    let connections = 0;
    for (const set of this.byMap.values()) connections += set.size;
    return {
      connections,
      maps: this.byMap.size,
      broadcasts: this.broadcasts,
      framesSent: this.framesSent,
      dropped: this.dropped,
    };
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const set of this.byMap.values()) {
      for (const sub of set) sub.socket.terminate();
    }
    this.byMap.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
