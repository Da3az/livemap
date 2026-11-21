import { cn } from "cn";
import { useId, type ReactNode } from "react";
import { useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useExtrasStrings } from "@/i18n/editor-extras";
import type { RichText, TextDir } from "@/model/types";
import { effectiveDir } from "../shared/format";

const NEXT: Record<TextDir, TextDir> = { auto: "ltr", ltr: "rtl", rtl: "auto" };

const FIELD =
  "w-full min-w-0 rounded-field border border-rule-strong bg-panel px-2 text-ink transition-colors duration-100 placeholder:text-ink-3 hover:border-ink-3 disabled:opacity-50";

/**
 * A line of the map's own text. It carries its direction: automatic takes it
 * from the first strong character, and the control at the end of the label
 * pins it left to right or right to left. Empty text is stored as nothing.
 */
export function DirTextField({
  label,
  value,
  onChange,
  placeholder,
  serif = false,
  disabled = false,
  after,
}: {
  label: string;
  value: RichText | null;
  onChange: (value: RichText | null) => void;
  placeholder?: string;
  /** The map title and the key heading are set in the title face. */
  serif?: boolean;
  disabled?: boolean;
  /** Something offered under the field, such as a suggested wording. */
  after?: ReactNode;
}) {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().settings.direction;
  const uiDir = useEditorStore((state) => state.doc.uiDir);
  const id = useId();
  const text = value ?? { value: "", dir: "auto" as const };
  const resolved = effectiveDir(text, uiDir);
  const state = text.dir === "auto" ? t.auto(t.short[resolved]) : t.short[text.dir];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs text-ink-2">
          {label}
        </label>
        <button
          type="button"
          disabled={disabled}
          aria-label={t.change(label, state)}
          title={t.cycle}
          onClick={() => {
            onChange({ value: text.value, dir: NEXT[text.dir] });
            store.closeStep();
          }}
          className={cn(
            "h-5 rounded-key px-1 text-2xs font-medium hover:bg-well disabled:opacity-50",
            text.dir === "auto" ? "text-ink-3" : "text-ink",
          )}
        >
          {state}
        </button>
      </div>
      <input
        id={id}
        type="text"
        dir={resolved}
        disabled={disabled}
        value={text.value}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "" && text.dir === "auto" ? null : { value: next, dir: text.dir });
        }}
        onBlur={() => store.closeStep()}
        className={cn(FIELD, serif ? "h-row font-title text-base font-semibold" : "h-field text-sm")}
      />
      {after}
    </div>
  );
}
