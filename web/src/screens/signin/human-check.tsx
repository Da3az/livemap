import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { useShellStrings } from "@/i18n/shell";

type Phase = "idle" | "verifying" | "verified";

/**
 * Stands where the human-verification widget will be mounted, at the size
 * such a widget takes, so the layout around it is the real one. It hands back
 * a token the mock accepts. INTEGRATION: replace the body with the provider's
 * widget rendered for `siteKey`; `onToken` keeps its meaning.
 */
export function HumanCheck({ siteKey, invalid, onToken }: { siteKey: string; invalid: boolean; onToken: (token: string | null) => void }) {
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
