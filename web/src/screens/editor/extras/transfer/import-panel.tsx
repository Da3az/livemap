import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { newId, selectCounts, useEditorStore, useEditorStoreApi, type ImportResult, type Refusal, type SkipReason } from "@/editor/store";
import { useExtrasStrings, type ExtrasStrings } from "@/i18n/editor-extras";
import type { FeatureKind, MapFeature } from "@/model/types";
import { useEditorRuntime } from "../../runtime";
import { Pick } from "../shared/controls";

/** Where an import stands. Kept by the menu, so closing the panel does not lose a review in progress. */
export type ImportState =
  | { step: "source"; problem: string | null }
  | { step: "review"; name: string; result: ImportResult; refusal: Refusal | null }
  | { step: "done"; name: string; ids: string[] };

export const IMPORT_START: ImportState = { step: "source", problem: null };

const KINDS: FeatureKind[] = ["area", "line", "arrow", "frontline", "point", "annotation"];
const REASONS: SkipReason[] = ["unsupported_type", "no_geometry", "bad_coordinates", "too_few_points", "limit_reached"];
const NO_GROUP = "none";
const NEW_GROUP = "new";
const OWN_STYLE = "own";

function refusalText(refusal: Refusal, t: ExtrasStrings["transfer"]): string {
  if (refusal.code === "feature_limit") return t.import.limitRefused(refusal.wouldBe, refusal.max);
  if (refusal.code === "read_only") return t.import.readOnly;
  return t.import.refused;
}

function Source({ problem, onText }: { problem: string | null; onText: (name: string, text: string) => void }) {
  const t = useExtrasStrings().transfer.import;
  const file = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState("");
  return (
    <div className="flex flex-col gap-2.5">
      {problem !== null ? <Notice tone="danger" title={problem} /> : null}
      <div className="flex items-center gap-2">
        <Button variant="outline" onPress={() => file.current?.click()}>
          <Icon name="upload" size={14} />
          {t.choose}
        </Button>
        <p className="text-xs text-ink-2">{t.orDrop}</p>
        <input
          ref={file}
          type="file"
          data-import-file
          accept=".geojson,.json,application/geo+json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label={t.choose}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen === undefined) return;
            void chosen.text().then(
              (text) => onText(chosen.name, text),
              () => onText(chosen.name, ""),
            );
          }}
        />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-2">{t.paste}</span>
        <textarea
          dir="ltr"
          spellCheck={false}
          value={pasted}
          data-import-paste
          placeholder='{ "type": "FeatureCollection", "features": [ … ] }'
          onChange={(event) => setPasted(event.target.value)}
          className="h-24 w-full resize-none rounded-field border border-rule-strong bg-panel p-2 text-xs text-ink tabular-nums placeholder:text-ink-3 hover:border-ink-3"
        />
      </label>
      <Button variant="outline" isDisabled={pasted.trim() === ""} className="self-start" onPress={() => onText(t.pastedName, pasted)}>
        {t.review}
      </Button>
      <p className="text-xs text-ink-3">{t.accepts}</p>
    </div>
  );
}

function Review({
  state,
  onState,
}: {
  state: Extract<ImportState, { step: "review" }>;
  onState: (state: ImportState) => void;
}) {
  const store = useEditorStoreApi();
  const strings = useExtrasStrings();
  const t = strings.transfer.import;
  const counts = useEditorStore(selectCounts);
  const groups = useEditorStore((current) => current.doc.settings.groups);
  const presets = useEditorStore((current) => current.doc.settings.presets);
  const [group, setGroup] = useState(NO_GROUP);
  const [preset, setPreset] = useState(OWN_STYLE);
  const { result, name } = state;

  const byKind = useMemo(() => {
    const tally = new Map<FeatureKind, { count: number; sources: Map<string, number> }>();
    for (const item of result.imported) {
      const entry = tally.get(item.kind) ?? { count: 0, sources: new Map<string, number>() };
      entry.count += 1;
      entry.sources.set(item.sourceType, (entry.sources.get(item.sourceType) ?? 0) + 1);
      tally.set(item.kind, entry);
    }
    return KINDS.flatMap((kind) => {
      const entry = tally.get(kind);
      return entry === undefined ? [] : [{ kind, count: entry.count, sources: [...entry.sources].map(([type, count]) => `${count} ${type}`).join(", ") }];
    });
  }, [result.imported]);

  const skipped = useMemo(
    () =>
      REASONS.flatMap((reason) => {
        const items = result.skipped.filter((item) => item.reason === reason);
        if (items.length === 0) return [];
        const types = [...new Set(items.flatMap((item) => (item.sourceType === null ? [] : [item.sourceType])))].join(", ");
        return [{ reason, count: items.length, types }];
      }),
    [result.skipped],
  );

  const adding = result.features.length;
  const over = adding > counts.limit.remaining;
  const chosenPreset = presets.find((candidate) => candidate.id === preset);
  const restyled = chosenPreset === undefined ? 0 : result.features.filter((feature) => chosenPreset.appliesTo.includes(feature.kind)).length;
  const groupName = name.replace(/\.(geo)?json$/i, "");

  const add = (): void => {
    const groupId = group === NEW_GROUP ? newId() : group === NO_GROUP ? null : group;
    const features = result.features.map(
      (feature): MapFeature => ({
        ...feature,
        groupId: group === NEW_GROUP ? null : groupId,
        presetId: chosenPreset !== undefined && chosenPreset.appliesTo.includes(feature.kind) ? chosenPreset.id : null,
      }),
    );
    const outcome = store.importFeatures(
      features,
      group === NEW_GROUP && groupId !== null ? { newGroup: { id: groupId, name: { value: groupName, dir: "auto" } } } : {},
    );
    if (outcome.ok) onState({ step: "done", name, ids: [...store.getState().selection.ids] });
    else onState({ ...state, refusal: outcome.refusal });
  };

  return (
    <div className="flex flex-col gap-2.5" data-import-review>
      <p className="text-sm">
        <span dir="auto" className="font-semibold">
          {name}
        </span>
        <span className="text-ink-2"> · {adding === 0 ? t.nothingUsable : t.willAdd(adding)}</span>
      </p>

      {byKind.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th>{t.columns.kind}</th>
              <th>{t.columns.from}</th>
            </tr>
          </thead>
          <tbody>
            {byKind.map((row) => (
              <tr key={row.kind} className="border-b border-rule last:border-b-0">
                <td className="py-1 pe-2">
                  <span className="flex items-center gap-1.5">
                    <Icon name={row.kind} size={14} className="text-ink-3" />
                    {t.kinds[row.kind](row.count)}
                  </span>
                </td>
                <td dir="ltr" className="py-1 text-end text-xs text-ink-3 tabular-nums">
                  {row.sources}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {skipped.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-block bg-well p-2" data-import-skipped>
          <p className="text-xs font-semibold text-ink">{t.skipped(result.skipped.length)}</p>
          <ul className="flex flex-col gap-0.5 text-xs text-ink-2">
            {skipped.map((row) => (
              <li key={row.reason} className="flex items-baseline justify-between gap-3">
                <span>
                  <span className="font-medium text-ink tabular-nums">{row.count}</span> · {t.reasons[row.reason]}
                </span>
                <span dir="ltr" className="shrink-0 text-ink-3">
                  {row.types}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {adding > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-ink-2">{t.group}</span>
            <Pick
              label={t.group}
              value={group}
              onChange={setGroup}
              data-import-group
              options={[
                { value: NO_GROUP, label: t.noGroup },
                { value: NEW_GROUP, label: t.newGroup(groupName), dir: "auto" },
                ...groups.map((existing) => ({ value: existing.id, label: existing.name.value, dir: existing.name.dir })),
              ]}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-ink-2">{t.style}</span>
            <Pick
              label={t.style}
              value={preset}
              onChange={setPreset}
              data-import-style
              options={[
                { value: OWN_STYLE, label: t.ownStyle },
                ...presets.map((existing) => ({ value: existing.id, label: existing.name.value, dir: existing.name.dir })),
              ]}
            />
          </div>
          {chosenPreset !== undefined && restyled < adding ? <p className="col-span-2 text-xs text-ink-3">{t.styleApplies(restyled, adding)}</p> : null}
        </div>
      ) : null}

      {over ? (
        <Notice tone="danger" title={t.overLimitTitle}>
          {t.overLimit(adding, counts.limit.remaining, counts.limit.used, counts.limit.max)}
        </Notice>
      ) : null}
      {state.refusal !== null ? <Notice tone="danger" title={refusalText(state.refusal, strings.transfer)} /> : null}

      <div className="flex items-center gap-2">
        <Button isDisabled={adding === 0 || over} onPress={add} data-import-add>
          {t.add(adding)}
        </Button>
        <Button variant="ghost" onPress={() => onState(IMPORT_START)}>
          {t.back}
        </Button>
        <p className="ms-auto text-xs text-ink-3 tabular-nums">{t.room(counts.limit.used, counts.limit.max)}</p>
      </div>
    </div>
  );
}

/** Import GeoJSON: choose, drop or paste; review what it holds; then add it as one undo step. */
export function ImportPanel({ state, onState, onText }: { state: ImportState; onState: (state: ImportState) => void; onText: (name: string, text: string) => void }) {
  const store = useEditorStoreApi();
  const { controller } = useEditorRuntime();
  const t = useExtrasStrings().transfer.import;
  const readOnly = useEditorStore((current) => current.access.readOnly !== null);

  if (readOnly) return <Notice tone="info" title={t.readOnly} />;
  if (state.step === "source") return <Source problem={state.problem} onText={onText} />;
  if (state.step === "review") return <Review state={state} onState={onState} />;
  return (
    <div className="flex flex-col gap-2.5" data-import-done>
      <Notice tone="success" title={t.added(state.ids.length)}>
        {t.addedHelp}
      </Notice>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onPress={() => controller?.fitFeatures(state.ids)}>
          {t.zoomTo}
        </Button>
        <Button
          variant="outline"
          onPress={() => {
            store.undo();
            onState(IMPORT_START);
          }}
        >
          {t.undo}
        </Button>
        <Button variant="ghost" onPress={() => onState(IMPORT_START)}>
          {t.another}
        </Button>
      </div>
    </div>
  );
}
