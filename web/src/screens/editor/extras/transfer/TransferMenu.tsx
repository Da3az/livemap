import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogTrigger } from "react-aria-components";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { importGeoJson, selectCounts, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useLang } from "@/i18n";
import { useExtrasStrings } from "@/i18n/editor-extras";
import { useEditorRuntime } from "../../runtime";
import { onTransferRequest, type TransferView } from "../shared/bus";
import { Check, Segmented } from "../shared/controls";
import { formatBytes } from "../shared/format";
import { FloatingPanel } from "../shared/overlay";
import { downloadGeoJson, type GeoJsonFile, type GeoJsonScope } from "./geojson-export";
import { ImagePanel } from "./image-panel";
import { IMPORT_START, ImportPanel, type ImportState } from "./import-panel";

/** Larger than any map this tool can hold; refused before it is parsed. */
const MAX_FILE_CHARS = 20_000_000;

function GeoJsonPanel() {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().transfer.geojson;
  const lang = useLang();
  const counts = useEditorStore(selectCounts);
  const selected = useEditorStore((state) => state.selection.ids.length);
  const [scope, setScope] = useState<GeoJsonScope>("all");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [saved, setSaved] = useState<GeoJsonFile | null>(null);
  const effective: GeoJsonScope = scope === "selection" && selected === 0 ? "all" : scope;
  return (
    <div className="flex flex-col gap-2.5" data-geojson-export>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-2">{t.scope}</span>
        <Segmented
          label={t.scope}
          value={effective}
          onChange={setScope}
          className="w-full"
          options={[
            { value: "all", label: t.all(counts.features) },
            { value: "selection", label: t.selection(selected), disabled: selected === 0 },
          ]}
        />
      </div>
      {effective === "all" ? (
        <Check checked={includeHidden} disabled={counts.hidden === 0} onChange={setIncludeHidden}>
          {t.includeHidden(counts.hidden)}
        </Check>
      ) : null}
      <p className="text-xs text-ink-3">{t.about}</p>
      <div className="flex items-center gap-2">
        <Button onPress={() => setSaved(downloadGeoJson(store.getState(), effective, includeHidden))} data-geojson-download>
          <Icon name="download" size={14} />
          {t.download}
        </Button>
        {saved !== null ? (
          <p role="status" data-geojson-done className="min-w-0 text-xs font-medium text-success tabular-nums">
            <span dir="ltr">{saved.fileName}</span> · {t.saved(saved.count)} · {formatBytes(saved.blob.size, lang)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Import / Export control for the top bar. GeoJSON comes in by file, by a
 * drop anywhere on the editor, or by paste, and is reviewed before anything
 * is added; the map goes out as GeoJSON or as a PNG.
 */
export function TransferMenu() {
  const store = useEditorStoreApi();
  const { portalContainer } = useEditorRuntime();
  const t = useExtrasStrings().transfer;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<TransferView>("import");
  const [incoming, setIncoming] = useState<ImportState>(IMPORT_START);
  const [dropping, setDropping] = useState(false);

  const review = useCallback(
    (name: string, text: string): void => {
      setView("import");
      setOpen(true);
      if (text.trim() === "") {
        setIncoming({ step: "source", problem: t.import.unreadable(name) });
        return;
      }
      if (text.length > MAX_FILE_CHARS) {
        setIncoming({ step: "source", problem: t.import.tooLarge(name) });
        return;
      }
      const state = store.getState();
      const result = importGeoJson(text, {
        uiDir: state.doc.uiDir,
        userId: state.access.userId,
        now: new Date().toISOString(),
        defaults: state.drawDefaults,
      });
      if (result.error !== null) {
        setIncoming({ step: "source", problem: result.error === "invalid_json" ? t.import.invalidJson(name) : t.import.notGeoJson(name) });
        return;
      }
      setIncoming({ step: "review", name, result, refusal: null });
    },
    [store, t],
  );

  useEffect(
    () =>
      onTransferRequest((requested) => {
        setView(requested);
        setOpen(true);
      }),
    [],
  );

  /* A file dropped anywhere on the editor goes straight to review. */
  useEffect(() => {
    const root = portalContainer?.closest("[data-editor-root]") ?? null;
    if (root === null || !(root instanceof HTMLElement)) return undefined;
    let depth = 0;
    const carriesFile = (event: DragEvent): boolean => event.dataTransfer?.types.includes("Files") === true;
    const onEnter = (event: DragEvent): void => {
      if (!carriesFile(event)) return;
      depth += 1;
      setDropping(true);
    };
    const onLeave = (event: DragEvent): void => {
      if (!carriesFile(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropping(false);
    };
    const onOver = (event: DragEvent): void => {
      if (carriesFile(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent): void => {
      if (!carriesFile(event)) return;
      event.preventDefault();
      depth = 0;
      setDropping(false);
      const file = event.dataTransfer?.files[0];
      if (file === undefined) return;
      void file.text().then(
        (text) => review(file.name, text),
        () => review(file.name, ""),
      );
    };
    root.addEventListener("dragenter", onEnter);
    root.addEventListener("dragleave", onLeave);
    root.addEventListener("dragover", onOver);
    root.addEventListener("drop", onDrop);
    return () => {
      root.removeEventListener("dragenter", onEnter);
      root.removeEventListener("dragleave", onLeave);
      root.removeEventListener("dragover", onOver);
      root.removeEventListener("drop", onDrop);
    };
  }, [portalContainer, review]);

  return (
    <>
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <Button variant="outline" data-transfer-trigger>
          {t.trigger}
          <Icon name="chevron" size={12} className="rotate-90 text-ink-3" />
        </Button>
        <FloatingPanel placement="bottom end" className="w-96 max-w-full overflow-y-auto">
          <Dialog aria-label={t.trigger} className="flex flex-col outline-none" data-transfer-panel>
            <div className="border-b border-rule p-2">
              <Segmented
                label={t.trigger}
                value={view}
                onChange={setView}
                size="default"
                className="w-full"
                options={[
                  { value: "import", label: t.views.import },
                  { value: "geojson", label: t.views.geojson },
                  { value: "image", label: t.views.image },
                ]}
              />
            </div>
            <div className="p-3">
              {view === "import" ? <ImportPanel state={incoming} onState={setIncoming} onText={review} /> : null}
              {view === "geojson" ? <GeoJsonPanel /> : null}
              {view === "image" ? <ImagePanel /> : null}
            </div>
          </Dialog>
        </FloatingPanel>
      </DialogTrigger>
      {dropping && portalContainer !== null
        ? createPortal(
            <div data-drop-target className="pointer-events-none fixed inset-0 z-60 flex items-center justify-center border-4 border-dashed border-plum bg-panel/85">
              <p className="rounded-block border border-rule-strong bg-panel px-4 py-3 text-base font-semibold text-ink">{t.dropHere}</p>
            </div>,
            portalContainer,
          )
        : null}
    </>
  );
}
