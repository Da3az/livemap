import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Notice, type NoticeTone } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { useLang } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";
import { useEditorLayout } from "../shared/layout";

/** A message over the map, under the controls it is about. It stays until it is dismissed or resolved. */
export function Message({
  tone,
  title,
  children,
  actions,
  onDismiss,
}: {
  tone: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: (() => void) | undefined;
}) {
  const t = useEditorStrings();
  const { touch } = useEditorLayout();
  return (
    <Notice
      tone={tone}
      title={title}
      className="pointer-events-auto shadow-overlay"
      action={
        onDismiss ? (
          <Button variant="ghost" size={touch ? "icon-lg" : "icon-sm"} aria-label={t.messages.dismiss} onPress={onDismiss} className={touch ? "size-11" : undefined}>
            <Icon name="close" size={14} />
          </Button>
        ) : undefined
      }
    >
      {children}
      {actions ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </Notice>
  );
}

/** A button inside a message. */
export function MessageAction({
  children,
  onPress,
  primary = false,
  isDisabled = false,
}: {
  children: ReactNode;
  onPress: () => void;
  primary?: boolean;
  isDisabled?: boolean;
}) {
  const { touch } = useEditorLayout();
  return (
    <Button variant={primary ? "default" : "outline"} size={touch ? "touch" : "default"} isDisabled={isDisabled} onPress={onPress}>
      {children}
    </Button>
  );
}

/**
 * The explanation of a refusal. The server's own sentence is in English: an
 * English editor shows it as it is; an Arabic editor explains in Arabic and
 * quotes the server beneath, in its own direction.
 */
export function Reason({ reason, fallback }: { reason: string | null; fallback: string }) {
  const lang = useLang();
  if (reason === null) return <p>{fallback}</p>;
  if (lang === "en") return <p>{reason}</p>;
  return (
    <>
      <p>{fallback}</p>
      <p dir="ltr" lang="en" className="mt-1 text-start text-xs text-ink-3">
        {reason}
      </p>
    </>
  );
}

export const MESSAGE_LINK = "rounded-key text-sm font-medium text-bathy underline decoration-1 underline-offset-2 hover:decoration-2";
