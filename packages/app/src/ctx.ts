import type { Api, ClientConfig, Session } from "./api.js";

/** One screen. `node` is mounted into the shell; the rest is lifecycle. */
export interface Page {
  readonly node: HTMLElement;
  /** Called once `node` is in the document — a map needs a sized container. */
  mounted?(): void;
  /** Return false to stay: the page holds work that would be lost. */
  canLeave?(): boolean;
  destroy?(): void;
}

export interface Ctx {
  readonly api: Api;
  readonly config: ClientConfig;
  /** The signed-in caller. Only pages behind sign-in receive a Ctx with one. */
  readonly session: Session;
  navigate(path: string): void;
  /**
   * One line at the foot of the page. Refusals — a quota, a rate limit, a
   * missing permission — are reported here and never in a dialog: none of them
   * is worth stopping the author for.
   */
  notify(text: string, kind?: "info" | "error"): void;
  /** Re-reads usage after something that changes it. */
  refreshSession(): Promise<void>;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
