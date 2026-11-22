import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useApi, useTheme } from "@/app/providers";
import { Icon } from "@/components/icons";
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { SHORTCUT_SECTIONS, useEditorStore, useEditorStoreApi, type ShortcutSection } from "@/editor/store";
import { useLang } from "@/i18n";
import { useExtrasStrings } from "@/i18n/editor-extras";
import { useEditorRuntime } from "../../runtime";
import { isMac } from "../shared/format";
import { usePortalContainer } from "../shared/overlay";
import { buildEntries, featureEntries, type PaletteEntry, type PaletteGroupId } from "./commands";
import { fold, matchScore } from "./fuzzy";
import { readRecent, rememberRecent } from "./recent";

const GROUP_ORDER: PaletteGroupId[] = [
  "recent",
  "tools",
  "edit",
  "arrange",
  "file",
  "view",
  "timeline",
  "styles",
  "basemap",
  "labels",
  "direction",
  "theme",
  "transfer",
  "features",
];

const SECTIONS: readonly string[] = ["tools", "edit", "arrange", "file", "view", "timeline"];

function isSection(group: PaletteGroupId): group is ShortcutSection {
  return SECTIONS.includes(group);
}

interface Group {
  id: PaletteGroupId;
  entries: PaletteEntry[];
  best: number;
}

function group(entries: readonly { entry: PaletteEntry; score: number }[], recent: readonly string[], searching: boolean): Group[] {
  const byId = new Map<PaletteGroupId, Group>();
  const put = (id: PaletteGroupId, entry: PaletteEntry, score: number): void => {
    const existing = byId.get(id) ?? { id, entries: [], best: Number.POSITIVE_INFINITY };
    existing.entries.push(entry);
    existing.best = Math.min(existing.best, score);
    byId.set(id, existing);
  };
  const ranked = [...entries].sort((a, b) => a.score - b.score);
  if (!searching) {
    for (const id of recent) {
      const found = entries.find((item) => item.entry.id === id);
      if (found !== undefined) put("recent", found.entry, 0);
    }
  }
  for (const item of ranked) put(item.entry.group, item.entry, item.score);
  const groups = [...byId.values()];
  const position = (id: PaletteGroupId): number => GROUP_ORDER.indexOf(id);
  return groups.sort((a, b) => (searching ? Math.floor(a.best) - Math.floor(b.best) : 0) || position(a.id) - position(b.id));
}

function Body() {
  const store = useEditorStoreApi();
  const state = useEditorStore((current) => current);
  const api = useApi();
  const runtime = useEditorRuntime();
  const { choice, setChoice } = useTheme();
  const navigate = useNavigate();
  const lang = useLang();
  const strings = useExtrasStrings();
  const t = strings.palette;
  const mac = useMemo(isMac, []);
  const [query, setQuery] = useState("");
  const [recent] = useState(readRecent);
  const folded = fold(query);

  const groups = useMemo(() => {
    const context = {
      state,
      store,
      api,
      controller: runtime.controller,
      lang,
      mac,
      t,
      names: strings.names,
      theme: choice,
      setTheme: setChoice,
      openPreview: runtime.openPreview,
      openVersions: () => void navigate(`/maps/${state.meta.id}/versions`),
    };
    const scored: { entry: PaletteEntry; score: number }[] = [];
    for (const entry of buildEntries(context)) {
      const score = matchScore(folded, entry.haystack);
      if (score === null) continue;
      scored.push({ entry, score: score - (folded !== "" && recent.includes(entry.id) ? 0.5 : 0) });
    }
    featureEntries(context, folded).forEach((entry, index) => scored.push({ entry, score: 2 + index / 100 }));
    return group(scored, recent, folded !== "");
  }, [state, store, api, runtime, lang, mac, t, strings, choice, setChoice, navigate, folded, recent]);

  const run = (entry: PaletteEntry): void => {
    store.setPaletteOpen(false);
    if (entry.memorable) rememberRecent(entry.id);
    if (entry.id !== "view.commandPalette") entry.run();
  };

  const heading = (id: PaletteGroupId): string => (isSection(id) ? SHORTCUT_SECTIONS[id][lang] : t.groups[id]);

  return (
    <div
      className="flex min-h-0 flex-col"
      onKeyDownCapture={(event) => {
        /* The search field would spend the first Escape on clearing itself; a palette closes. */
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        store.setPaletteOpen(false);
      }}
    >
      <Command inputValue={query} onInputChange={setQuery} filter={() => true} className="rounded-none! bg-panel p-0">
        <div className="border-b border-rule">
          <CommandInput placeholder={t.placeholder} dir="auto" className="placeholder:text-ink-3" />
        </div>
        <CommandList
          aria-label={t.title}
          className="max-h-96 p-1"
          renderEmptyState={() => (
            <p role="status" className="px-3 py-4 text-sm text-ink-2">
              {t.noMatch(query.trim())}
            </p>
          )}
        >
          {groups.map((section) => {
            /* Recent mixes sections, so there each row names its own; elsewhere the heading does, with a setting's current value. */
            const mixed = section.id === "recent";
            const current = mixed ? undefined : section.entries.find((entry) => entry.current !== undefined)?.current;
            return (
            <CommandGroup key={section.id} id={section.id} heading={current === undefined ? heading(section.id) : `${heading(section.id)} · ${current}`} className="p-0 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-2xs **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-plum">
              {section.entries.map((entry) => (
                <CommandItem
                  key={`${section.id}:${entry.id}`}
                  id={`${section.id}:${entry.id}`}
                  textValue={entry.label}
                  isDisabled={entry.disabledReason !== undefined}
                  onAction={() => run(entry)}
                  className="min-h-field rounded-key! px-2 py-1 data-focused:bg-well data-[disabled=true]:text-ink-3 data-[disabled=true]:opacity-100"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center text-survey">
                    {entry.checked === true ? <Icon name="check" size={13} /> : null}
                  </span>
                  <span className="min-w-0 truncate">{entry.label}</span>
                  {entry.detail !== undefined ? <span className="shrink-0 text-xs text-ink-3">{entry.detail}</span> : null}
                  <span data-slot="command-shortcut" className="ms-auto flex shrink-0 items-center gap-2 ps-3">
                    {entry.disabledReason !== undefined ? <span className="text-xs text-ink-3">{entry.disabledReason}</span> : null}
                    {entry.checked === true ? <span className="text-xs font-medium text-survey">{t.current}</span> : null}
                    {mixed && entry.checked !== true && entry.current !== undefined ? <span className="text-xs text-ink-3">{t.now(entry.current)}</span> : null}
                    {mixed && entry.group !== "features" ? (
                      <span data-palette-section className="rounded-key border border-rule px-1 text-2xs text-ink-2">
                        {heading(entry.group)}
                      </span>
                    ) : null}
                    {entry.keys !== undefined ? (
                      <Kbd dir="ltr" className="h-5 min-w-5 bg-well px-1.5 text-ink-2 tabular-nums">
                        {entry.keys}
                      </Kbd>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            );
          })}
        </CommandList>
      </Command>
    </div>
  );
}

/**
 * Every command by name: the shortcut table, plus features, styles,
 * basemap, language, direction, theme, preview, versions and export. Opened
 * by the store's `paletteOpen`.
 */
export function CommandPalette() {
  const store = useEditorStoreApi();
  const open = useEditorStore((state) => state.view.paletteOpen);
  const container = usePortalContainer();
  const t = useExtrasStrings().palette;
  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => store.setPaletteOpen(next)}
      title={t.title}
      description={t.description}
      UNSTABLE_portalContainer={container}
      className="top-24 gap-0 rounded-block! border border-rule-strong bg-panel shadow-overlay ring-0 sm:max-w-xl"
    >
      {open ? <Body /> : null}
    </CommandDialog>
  );
}
