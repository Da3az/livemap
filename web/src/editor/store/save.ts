import { ApiError } from "@/api/client";
import type { PublishState, SaveState } from "./state";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The save state a failed `editMap` leaves behind. `nowMs` anchors the rate-limit countdown. */
export function saveStateFromError(error: unknown, nowMs: number, featureCount: number): SaveState {
  if (!(error instanceof ApiError)) return { kind: "unknown", message: message(error) };
  switch (error.code) {
    case "stale_revision":
      return { kind: "stale", current: error.current };
    case "quota_exceeded":
      return { kind: "quota_exceeded", reason: error.reason };
    case "rate_limited":
    case "guest_capacity": {
      const seconds = error.retryAfter ?? 5;
      return { kind: "rate_limited", retryAt: nowMs + seconds * 1000, retryAfterSeconds: seconds };
    }
    case "forbidden":
      return { kind: "not_permitted", why: "forbidden", reason: error.reason };
    case "unauthorised":
      return { kind: "signed_out" };
    case "network":
      return { kind: "offline" };
    case "body_too_large":
      return { kind: "too_large", featureCount };
    case "invalid_request":
    case "human_check_failed":
    case "guest_signup_disabled":
    case "not_found":
    case "internal_error":
      return { kind: "unknown", message: error.reason ?? error.code };
  }
}

/** The publish state a failed `publishMap` leaves behind. */
export function publishStateFromError(error: unknown, nowMs: number): PublishState {
  if (!(error instanceof ApiError)) return { kind: "unknown", message: message(error) };
  switch (error.code) {
    case "quota_exceeded":
      return { kind: "quota_exceeded", reason: error.reason };
    case "rate_limited":
    case "guest_capacity": {
      const seconds = error.retryAfter ?? 5;
      return { kind: "rate_limited", retryAt: nowMs + seconds * 1000, retryAfterSeconds: seconds };
    }
    case "forbidden":
      return { kind: "not_permitted", why: "forbidden", reason: error.reason };
    case "unauthorised":
      return { kind: "signed_out" };
    case "network":
      return { kind: "offline" };
    case "stale_revision":
    case "body_too_large":
    case "invalid_request":
    case "human_check_failed":
    case "guest_signup_disabled":
    case "not_found":
    case "internal_error":
      return { kind: "unknown", message: error.reason ?? error.code };
  }
}

/** Whole seconds left until `retryAt` (epoch milliseconds), never negative. */
export function secondsUntil(retryAt: number, nowMs: number): number {
  return Math.max(0, Math.ceil((retryAt - nowMs) / 1000));
}
