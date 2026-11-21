import { cn } from "cn";
import type { ReactNode } from "react";

export type NoticeTone = "info" | "success" | "warning" | "danger";

const TONES: Record<NoticeTone, string> = {
  info: "border-info text-ink",
  success: "border-success text-ink",
  warning: "border-warning text-ink",
  danger: "border-danger text-ink",
};

const MARK: Record<NoticeTone, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/**
 * A message shown in place, where the thing it is about lives.
 * Errors and refusals use this; nothing in the app raises a blocking dialog for them.
 * `title` says what happened; children say what the person can do about it.
 */
export function Notice({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-field border border-s-4 bg-panel px-3 py-2 text-sm", TONES[tone], className)}
    >
      <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-pill", MARK[tone])} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-0.5 text-ink-2">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
