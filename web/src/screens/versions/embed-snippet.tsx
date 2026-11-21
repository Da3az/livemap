import { useEffect, useRef, useState } from "react";
import { useVersionsStrings } from "@/i18n/versions";
import type { EmbedAttribute } from "./model";

type Strings = ReturnType<typeof useVersionsStrings>;

const HELP: Record<EmbedAttribute["name"], (t: Strings) => string[]> = {
  src: (t) => [t.attrSrc, t.updatesInPlace, t.attrLang],
  title: (t) => [t.attrTitle],
  style: (t) => [t.attrStyle],
  loading: (t) => [t.attrLoading],
  allow: (t) => [t.attrAllow],
  sandbox: (t) => [t.attrSandbox],
  referrerpolicy: (t) => [t.attrReferrer],
};

const FLASH_MS = 1600;

/**
 * The embed code, one attribute per line, set as code without a monospace
 * face. Each attribute's name opens its explanation under it, and a line the
 * options just changed is marked for a moment, so the link between a control
 * and the code is visible.
 */
export function EmbedSnippet({ attributes }: { attributes: EmbedAttribute[] }) {
  const t = useVersionsStrings();
  const [open, setOpen] = useState<EmbedAttribute["name"] | null>(null);
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  const previous = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const now = new Map(attributes.map((attr) => [attr.name, attr.value]));
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    const changed = new Set([...now].filter(([name, value]) => before.get(name) !== value).map(([name]) => name));
    if (changed.size === 0) return;
    setFlashing(changed);
    const timer = window.setTimeout(() => setFlashing(new Set()), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [attributes]);

  return (
    <div dir="ltr" className="rounded-field border border-rule-strong bg-well py-2 font-ui text-sm leading-relaxed text-ink">
      <span className="block px-3 text-ink-3">&lt;iframe</span>
      <ul>
        {attributes.map((attr) => {
          const isOpen = open === attr.name;
          const isNew = flashing.has(attr.name);
          return (
            <li key={attr.name} className={`ps-6 pe-3 transition-colors duration-200 motion-reduce:transition-none ${isNew ? "bg-selected" : ""}`}>
              <span className="flex items-baseline">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={t.explain(attr.name)}
                  onClick={() => setOpen(isOpen ? null : attr.name)}
                  className="shrink-0 rounded-key font-semibold text-plum underline decoration-dotted decoration-1 underline-offset-3 hover:decoration-solid"
                >
                  {attr.name}
                </button>
                <span className="min-w-0 break-all">
                  <span className="text-ink-3">=&quot;</span>
                  <bdi>{attr.value}</bdi>
                  <span className="text-ink-3">&quot;</span>
                </span>
                {isNew ? <span className="ms-auto shrink-0 ps-2 text-2xs text-survey">{t.changedNow}</span> : null}
              </span>
              {isOpen ? (
                <span className="mb-1 block border-s-2 border-plum ps-2 text-xs text-ink-2">
                  {HELP[attr.name](t).map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <span className="block px-3 text-ink-3">&gt;&lt;/iframe&gt;</span>
    </div>
  );
}
