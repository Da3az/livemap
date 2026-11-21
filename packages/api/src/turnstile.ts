// Cloudflare Turnstile, server side. The widget in the page proves nothing on
// its own — a token is only worth something once Siteverify has redeemed it.

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Decides whether a signup came from a person. `token` is whatever the client sent. */
export type HumanCheck = (
  token: string | undefined,
  remoteIp: string,
) => Promise<boolean>;

export interface TurnstileOptions {
  readonly secret: string;
  readonly fetchImpl?: typeof fetch;
  /** Siteverify is on the signup path, so it must not be able to hang it. */
  readonly timeoutMs?: number;
}

/**
 * Fails closed. A missing token, a rejected token, a timeout and an outage all
 * come back false: the endpoint this guards creates a tenant, and "the bot
 * check was down" is exactly the moment someone would choose to hammer it.
 */
export function turnstileCheck(opts: TurnstileOptions): HumanCheck {
  const doFetch = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const timeoutMs = opts.timeoutMs ?? 5_000;

  return async (token, remoteIp) => {
    // A bound on what gets forwarded, not a format check.
    if (!token || token.length > 4096) return false;

    try {
      const res = await doFetch(SITEVERIFY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: opts.secret,
          response: token,
          remoteip: remoteIp,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { success?: unknown };
      return body.success === true;
    } catch {
      return false;
    }
  };
}
