import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  SHORTCUTS,
  SHORTCUT_SECTIONS,
  formatShortcut,
  useEditorStore,
  useEditorStoreApi,
  type ShortcutDef,
  type ShortcutSection,
} from "@/editor/store";
import { useLang } from "@/i18n";
import { useExtrasStrings } from "@/i18n/editor-extras";
import { fold, matchScore } from "./palette/fuzzy";
import { isMac } from "./shared/format";

const SECTION_ORDER: ShortcutSection[] = ["tools", "edit", "arrange", "view", "timeline", "file"];

function Keys({ shortcut, mac, or }: { shortcut: ShortcutDef; mac: boolean; or: string }) {
  const all = [shortcut.keys, ...(shortcut.alternates ?? [])];
  return (
    <span className="flex shrink-0 items-center gap-1">
      {all.map((keys, index) => (
        <span key={keys} className="flex items-center gap-1">
          {index > 0 ? <span className="text-2xs text-ink-3">{or}</span> : null}
          <Kbd dir="ltr" className="h-5 min-w-5 bg-well px-1.5 text-ink-2 tabular-nums">
            {formatShortcut(keys, mac)}
          </Kbd>
        </span>
      ))}
    </span>
  );
}

function Sheet() {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().shortcuts;
  const lang = useLang();
  const mac = useMemo(isMac, []);
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    const folded = fold(query);
    return SECTION_ORDER.map((section) => ({
      section,
      rows: SHORTCUTS.filter((shortcut) => {
        if (shortcut.section !== section) return false;
        if (folded === "") return true;
        const keys = [shortcut.keys, ...(shortcut.alternates ?? [])].map((key) => formatShortcut(key, mac)).join(" ");
        const haystack = fold(`${shortcut.label.en} ${shortcut.label.ar} ${SHORTCUT_SECTIONS[section][lang]} ${keys} ${shortcut.keys}`);
        return matchScore(folded, haystack) !== null;
      }),
    })).filter((group) => group.rows.length > 0);
  }, [query, mac, lang]);

  const close = (): void => store.setShortcutSheetOpen(false);

  return (
    <section
      aria-label={t.title}
      data-shortcut-sheet
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      className="flex max-h-80 w-full flex-col border-t border-rule-strong bg-panel text-ink"
    >
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-rule px-3">
        <h2 className="font-title text-lg font-semibold">{t.title}</h2>
        <label className="ms-auto flex h-field w-56 items-center gap-1.5 rounded-field border border-rule-strong bg-panel px-2 outline-offset-1 outline-focus focus-within:outline-2">
          <Icon name="search" size={13} className="shrink-0 text-ink-3" />
          <input
            type="text"
            aria-label={t.search}
            placeholder={t.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
        </label>
        <Button variant="outline" size="sm" onPress={close}>
          {t.close}
          <Kbd dir="ltr">Esc</Kbd>
        </Button>
      </header>
      {sections.length === 0 ? (
        <p role="status" className="px-3 py-4 text-sm text-ink-2">
          {t.noMatch(query.trim())}
        </p>
      ) : (
        <div className="min-h-0 columns-2xs gap-6 overflow-y-auto px-3 py-2.5">
          {sections.map(({ section, rows }) => (
            <section key={section} aria-label={SHORTCUT_SECTIONS[section][lang]} className="mb-3 break-inside-avoid">
              <h3 className="mb-1 border-b border-rule pb-1 text-xs font-semibold text-plum">{SHORTCUT_SECTIONS[section][lang]}</h3>
              <ul className="flex flex-col">
                {rows.map((shortcut) => (
                  <li key={shortcut.id} className="flex min-h-6 items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{shortcut.label[lang]}</span>
                    <Keys shortcut={shortcut} mac={mac} or={t.or} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Every keyboard shortcut, docked along the bottom edge. Not a dialog: the
 * map above it stays usable while it is open.
 */
export function ShortcutSheet() {
  const open = useEditorStore((state) => state.view.shortcutSheetOpen);
  return open ? <Sheet /> : null;
}
