/**
 * One place that knows what each error code looks like on the wire: its
 * status, the sentence a server would send with it, and its retry delay.
 */
import { ApiError, type ApiErrorCode } from "@/api/client";

interface ErrorDefaults {
  status: number;
  reason: string;
  retryAfter: number | null;
}

export const ERROR_DEFAULTS: Record<ApiErrorCode, ErrorDefaults> = {
  invalid_request: { status: 400, reason: "The request does not match what the server accepts.", retryAfter: null },
  unauthorised: { status: 401, reason: "You are not signed in, or the session has ended.", retryAfter: null },
  forbidden: { status: 403, reason: "Your role in this workspace does not allow this.", retryAfter: null },
  quota_exceeded: { status: 403, reason: "This workspace has reached its limit.", retryAfter: null },
  human_check_failed: { status: 403, reason: "The human check did not pass. Try it again.", retryAfter: null },
  guest_signup_disabled: { status: 403, reason: "Guest workspaces are switched off on this server.", retryAfter: null },
  not_found: { status: 404, reason: "There is no such map in this workspace.", retryAfter: null },
  stale_revision: { status: 409, reason: "Someone else saved this map after you opened it.", retryAfter: null },
  body_too_large: { status: 413, reason: "This save is larger than the server accepts in one request.", retryAfter: null },
  rate_limited: { status: 429, reason: "Too many requests in a short time.", retryAfter: 30 },
  guest_capacity: { status: 503, reason: "All guest workspaces are in use at the moment.", retryAfter: 120 },
  network: { status: 0, reason: "The server could not be reached.", retryAfter: null },
  internal_error: { status: 500, reason: "The server failed while handling this request.", retryAfter: null },
};

export const ERROR_CODES: ApiErrorCode[] = [
  "invalid_request",
  "unauthorised",
  "forbidden",
  "quota_exceeded",
  "human_check_failed",
  "guest_signup_disabled",
  "not_found",
  "stale_revision",
  "body_too_large",
  "rate_limited",
  "guest_capacity",
  "network",
  "internal_error",
];

export function isErrorCode(value: string): value is ApiErrorCode {
  return ERROR_CODES.some((code) => code === value);
}

export function apiError(
  code: ApiErrorCode,
  overrides: { reason?: string; retryAfter?: number | null; status?: number; current?: ApiError["current"] } = {},
): ApiError {
  const defaults = ERROR_DEFAULTS[code];
  return new ApiError({
    code,
    status: overrides.status ?? defaults.status,
    reason: overrides.reason ?? defaults.reason,
    retryAfter: overrides.retryAfter === undefined ? defaults.retryAfter : overrides.retryAfter,
    current: overrides.current ?? null,
  });
}
