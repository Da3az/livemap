import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useShellStrings } from "@/i18n/shell";

type Phase = "idle" | "verifying" | "verified";

interface HumanCheckProps {
  siteKey: string;
  invalid: boolean;
  onToken: (token: string | null) => void;
}

/** The mock hands out site keys of this form; anything else is a real Cloudflare Turnstile key. */
const MOCK_SITE_KEY = /^mock-/;

/**
 * The human check before a guest workspace is created: Cloudflare Turnstile
 * for a real site key, a stand-in of the same size for the mock's. `onToken`
 * receives the token to send with the signup, or null when it lapses.
 */
export function HumanCheck(props: HumanCheckProps) {
  return MOCK_SITE_KEY.test(props.siteKey) ? <StandInCheck {...props} /> : <TurnstileCheck {...props} />;
}

interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      theme: "light" | "dark";
      size: "normal" | "flexible";
    },
  ): string;
  remove(widgetId: string): void;
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let turnstileLoad: Promise<Turnstile> | null = null;

/** Loaded only when a real site key is configured; a deployment without one never contacts the host. */
function loadTurnstile(): Promise<Turnstile> {
  const host = window as unknown as { turnstile?: Turnstile };
  if (host.turnstile) return Promise.resolve(host.turnstile);
  turnstileLoad ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => (host.turnstile ? resolve(host.turnstile) : reject(new Error("unavailable")));
    script.onerror = () => {
      turnstileLoad = null;
      reject(new Error("unavailable"));
    };
    document.head.append(script);
  });
  return turnstileLoad;
}

function TurnstileCheck({ siteKey, invalid, onToken }: HumanCheckProps) {
  const t = useShellStrings();
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let widget: { api: Turnstile; id: string } | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        const id = api.render(container.current, {
          sitekey: siteKey,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          size: "flexible",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => {
            onToken(null);
            setFailed(true);
          },
        });
        widget = { api, id };
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widget) widget.api.remove(widget.id);
    };
  }, [siteKey, onToken]);

  return (
    <div role="group" aria-label={t.signin.humanLabel} className={`w-full max-w-xs rounded-key border ${invalid ? "border-danger" : "border-transparent"}`}>
      <div ref={container} className="min-h-16" />
      {failed ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {t.signin.humanUnavailable}
        </p>
      ) : null}
    </div>
  );
}

function StandInCheck({ siteKey, invalid, onToken }: HumanCheckProps) {
  const t = useShellStrings();
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (phase !== "verifying") return;
    const id = window.setTimeout(() => {
      setPhase("verified");
      onToken(`human-${siteKey}`);
    }, 700);
    return () => window.clearTimeout(id);
  }, [phase, siteKey, onToken]);

  const words = phase === "idle" ? t.signin.humanPrompt : phase === "verifying" ? t.signin.humanVerifying : t.signin.humanVerified;

  return (
    <div
      role="group"
      aria-label={t.signin.humanLabel}
      className={`flex h-16 w-full max-w-xs items-center gap-3 rounded-key border bg-well px-3 ${invalid ? "border-danger" : "border-rule-strong"}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={phase === "verified"}
        aria-busy={phase === "verifying"}
        aria-label={t.signin.humanPrompt}
        disabled={phase !== "idle"}
        onClick={() => setPhase("verifying")}
        className="grid size-6 shrink-0 place-items-center rounded-key border border-rule-strong bg-panel text-success"
      >
        {phase === "verified" ? <Icon name="check" /> : null}
        {phase === "verifying" ? <span className="size-2 rounded-pill bg-ink-3" /> : null}
      </button>
      <span aria-live="polite" className="text-sm font-medium text-ink">
        {words}
      </span>
      <span className="ms-auto text-end text-2xs text-ink-3">
        {t.signin.humanCaption}
        <br />
        <span className="tabular-nums">{siteKey}</span>
      </span>
    </div>
  );
}
