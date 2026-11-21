import { useEffect, useRef, useState } from "react";
import type { RichText } from "@/model/types";

export interface RenameTarget {
  key: string;
  name: RichText;
  label: string;
  /** Where the name sits, relative to the list body. */
  box: { top: number; insetStart: number; width: number; height: number };
}

/**
 * The inline rename field. It is laid over the row instead of inside it, so
 * the tree's own keys (arrows, type-ahead, Space) never see what is typed.
 */
export function RenameField({ target, onCommit, onCancel }: { target: RenameTarget; onCommit: (value: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(target.name.value);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    if (commit && next !== "" && next !== target.name.value) onCommit(next);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      dir={target.name.dir}
      aria-label={target.label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      style={{ top: target.box.top, insetInlineStart: target.box.insetStart, width: target.box.width, height: target.box.height }}
      className="absolute z-10 rounded-field border border-focus bg-panel px-1.5 text-sm text-ink outline-2 outline-focus"
    />
  );
}
