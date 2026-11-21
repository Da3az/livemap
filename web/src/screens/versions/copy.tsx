import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useVersionsStrings } from "@/i18n/versions";

type CopyState = "idle" | "copied" | "failed";

const SHOWN_MS = 2_400;

/** Copy with an answer: the state says whether the text reached the clipboard, and resets after a moment. */
export function useCopy(): { state: CopyState; copy: (text: string) => void } {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback((text: string) => {
    const settle = (next: CopyState) => {
      setState(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), next === "failed" ? SHOWN_MS * 2 : SHOWN_MS);
    };
    if (!navigator.clipboard) {
      settle("failed");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => settle("copied"),
      () => settle("failed"),
    );
  }, []);

  return { state, copy };
}

/**
 * A copy control whose feedback replaces its own label, where the eye already
 * is. `compact` is the icon-only form for a table cell; it still says
 * "Copied" in words for the moment it applies.
 */
export function CopyButton({ text, label, compact = false, className = "" }: { text: string; label: string; compact?: boolean; className?: string }) {
  const t = useVersionsStrings();
  const { state, copy } = useCopy();
  const shape = compact
    ? "h-6 gap-1 rounded-key px-1 text-2xs text-ink-3 hover:bg-well hover:text-ink"
    : "h-field gap-1.5 rounded-field border border-rule-strong bg-panel px-2.5 text-sm text-ink hover:bg-well max-md:h-10 max-md:px-4";
  return (
    <button type="button" onClick={() => copy(text)} aria-label={compact && state === "idle" ? label : undefined} className={`inline-flex shrink-0 items-center font-medium whitespace-nowrap ${shape} ${className}`}>
      {state === "copied" ? (
        <>
          <Icon name="check" size={compact ? 12 : 14} className="text-success" />
          <span role="status">{t.copied}</span>
        </>
      ) : state === "failed" ? (
        <span role="alert" className="text-danger">
          {t.copyFailed}
        </span>
      ) : (
        <>
          <Icon name="copy" size={compact ? 12 : 14} />
          {compact ? null : label}
        </>
      )}
    </button>
  );
}
