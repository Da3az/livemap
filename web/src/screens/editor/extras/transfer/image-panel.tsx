import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/app/providers";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import type { ThemeMode } from "@/editor/controller";
import { useEditorStore, useEditorStoreApi, type Doc } from "@/editor/store";
import { useLang } from "@/i18n";
import { useExtrasStrings } from "@/i18n/editor-extras";
import type { Viewport } from "@/model/types";
import { useEditorRuntime } from "../../runtime";
import { Check, Segmented } from "../shared/controls";
import { downloadBlob, formatBytes, formatMoment } from "../shared/format";

type SizeId = "4:5" | "16:9" | "1:1" | "custom";
const SIZES: Record<Exclude<SizeId, "custom">, { width: number; height: number }> = {
  "4:5": { width: 1080, height: 1350 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};
const MIN_SIDE = 200;
const MAX_SIDE = 4096;
const PREVIEW_DELAY_MS = 500;

interface Request {
  key: string;
  width: number;
  height: number;
  furniture: boolean;
  theme: ThemeMode;
}

/** A rendered preview and exactly what it was rendered from. */
interface Shot {
  key: string;
  doc: Doc;
  viewport: Viewport | null;
  playhead: string | null;
  blob: Blob;
  url: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "exporting"; startedAt: number; reused: boolean; width: number; height: number; furniture: boolean }
  | { kind: "done"; fileName: string; bytes: number; seconds: number; width: number; height: number }
  | { kind: "failed"; message: string };

function clampSide(text: string): number | null {
  const value = Math.round(Number(text));
  return Number.isFinite(value) && value >= MIN_SIDE && value <= MAX_SIDE ? value : null;
}

function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

/**
 * Export the map as a PNG. The preview is the real thing: the engine renders
 * the image at 1x from the map's current view, so the framing, the title
 * block and the key are exactly what the file will hold.
 */
export function ImagePanel() {
  const store = useEditorStoreApi();
  const { controller } = useEditorRuntime();
  const t = useExtrasStrings().transfer.image;
  const lang = useLang();
  const { mode } = useTheme();
  const [size, setSize] = useState<SizeId>("4:5");
  const [custom, setCustom] = useState({ width: "1600", height: "900" });
  const [scale, setScale] = useState<"1" | "2">("2");
  const [furniture, setFurniture] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(mode);
  const [shot, setShot] = useState<Shot | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const busy = useRef(false);
  const wanted = useRef<Request | null>(null);
  const elapsed = useElapsedSeconds(status.kind === "exporting" ? status.startedAt : null);

  /* Anything the image depends on: a change to any of it makes the preview stale. */
  const viewport = useEditorStore((state) => state.live.viewport);
  const doc = useEditorStore((state) => state.doc);
  const playhead = useEditorStore((state) => state.timeline.playhead);

  const dimensions = size === "custom" ? { width: clampSide(custom.width), height: clampSide(custom.height) } : SIZES[size];
  const { width, height } = dimensions;
  const valid = width !== null && height !== null;
  const key = `${width}x${height}:${furniture}:${theme}`;
  const stale = shot === null || shot.key !== key || shot.doc !== doc || shot.viewport !== viewport || shot.playhead !== playhead;

  const render = useCallback(async (): Promise<void> => {
    if (controller === null) return;
    if (busy.current) return;
    busy.current = true;
    setPreviewing(true);
    try {
      while (wanted.current !== null) {
        const request = wanted.current;
        wanted.current = null;
        const from = store.getState();
        try {
          const blob = await controller.exportImage({
            width: request.width,
            height: request.height,
            pixelRatio: 1,
            furniture: request.furniture,
            theme: request.theme,
          });
          setShot((previous) => {
            if (previous !== null) URL.revokeObjectURL(previous.url);
            return {
              key: request.key,
              doc: from.doc,
              viewport: from.live.viewport,
              playhead: from.timeline.playhead,
              blob,
              url: URL.createObjectURL(blob),
            };
          });
          setPreviewProblem(null);
        } catch (error) {
          setPreviewProblem(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      busy.current = false;
      setPreviewing(false);
    }
  }, [controller, store]);

  useEffect(() => {
    if (width === null || height === null || controller === null) return undefined;
    const timer = window.setTimeout(() => {
      wanted.current = { key, width, height, furniture, theme };
      void render();
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [key, width, height, furniture, theme, controller, render, viewport, doc, playhead]);

  useEffect(
    () => () => {
      setShot((previous) => {
        if (previous !== null) URL.revokeObjectURL(previous.url);
        return null;
      });
    },
    [],
  );

  const exportNow = async (): Promise<void> => {
    if (controller === null || !valid) return;
    const pixelRatio = Number(scale);
    const fileName = `${store.getState().meta.slug}-${width}x${height}${pixelRatio === 2 ? "@2x" : ""}.png`;
    const startedAt = Date.now();
    const reused = pixelRatio === 1 && shot !== null && !stale;
    setStatus({ kind: "exporting", startedAt, reused, width: width * pixelRatio, height: height * pixelRatio, furniture });
    try {
      const blob = reused ? shot.blob : await controller.exportImage({ width, height, pixelRatio, furniture, theme });
      downloadBlob(blob, fileName);
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      setStatus({ kind: "done", fileName, bytes: blob.size, seconds, width: width * pixelRatio, height: height * pixelRatio });
    } catch (error) {
      setStatus({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  if (controller === null || !controller.capabilities.imageExport) return <Notice tone="info" title={t.unavailable} />;

  const exporting = status.kind === "exporting";
  return (
    <div className="flex flex-col gap-2.5" data-image-export>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-2">{t.size}</span>
        <Segmented
          label={t.size}
          value={size}
          onChange={setSize}
          className="w-full"
          options={[
            { value: "4:5", label: t.sizes.portrait },
            { value: "16:9", label: t.sizes.wide },
            { value: "1:1", label: t.sizes.square },
            { value: "custom", label: t.sizes.custom },
          ]}
        />
        {size === "custom" ? (
          <div className="flex items-center gap-1.5 text-sm">
            {(["width", "height"] as const).map((side) => (
              <label key={side} className="flex items-center gap-1.5">
                <span className="text-xs text-ink-2">{t[side]}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_SIDE}
                  max={MAX_SIDE}
                  value={custom[side]}
                  aria-invalid={clampSide(custom[side]) === null}
                  onChange={(event) => setCustom({ ...custom, [side]: event.target.value })}
                  className="h-field w-20 rounded-field border border-rule-strong bg-panel px-1.5 text-end text-sm tabular-nums aria-invalid:border-danger"
                />
              </label>
            ))}
            <span className="text-xs text-ink-3">{t.px}</span>
          </div>
        ) : null}
        {valid ? null : <p className="text-xs text-danger">{t.sideRange(MIN_SIDE, MAX_SIDE)}</p>}
      </div>

      <figure className="flex flex-col gap-1">
        <div data-image-preview aria-busy={previewing} className="relative flex h-56 items-center justify-center overflow-hidden rounded-key border border-rule-strong bg-well">
          {shot !== null ? <img src={shot.url} alt={t.previewAlt} className="max-h-full max-w-full border border-rule object-contain" /> : null}
          {shot === null && previewProblem === null ? <p className="text-xs text-ink-3">{t.rendering}</p> : null}
          {shot !== null && (previewing || stale) ? (
            <p className="absolute start-1.5 top-1.5 rounded-key border border-rule-strong bg-panel px-1.5 py-0.5 text-2xs text-ink-2">{t.updating}</p>
          ) : null}
        </div>
        <figcaption className="text-xs text-ink-3">{t.framing}</figcaption>
        {previewProblem !== null ? <Notice tone="danger" title={t.previewFailed}>{previewProblem}</Notice> : null}
      </figure>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">{t.scale}</span>
          <Segmented label={t.scale} value={scale} onChange={setScale} className="w-full" options={[{ value: "1", label: "1x" }, { value: "2", label: "2x" }]} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">{t.theme}</span>
          <Segmented label={t.theme} value={theme} onChange={setTheme} className="w-full" options={[{ value: "light", label: t.light }, { value: "dark", label: t.dark }]} />
        </div>
      </div>
      <Check checked={furniture} onChange={setFurniture}>
        {t.furniture}
      </Check>
      <p className="border-s-2 border-info ps-2 text-xs text-ink-2">
        {t.attribution}
        {playhead !== null ? ` ${t.atTime(formatMoment(Date.parse(playhead), lang))}` : ""}
      </p>

      {status.kind === "failed" ? (
        <Notice tone="danger" title={t.failed}>
          {status.message}
        </Notice>
      ) : null}
      {status.kind === "done" ? (
        <p role="status" data-image-done className="text-xs font-medium text-success tabular-nums">
          <span dir="ltr">{status.fileName}</span> · {t.output(status.width, status.height)} · {formatBytes(status.bytes, lang)} · {t.took(status.seconds)}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button isDisabled={!valid || exporting} onPress={() => void exportNow()} data-image-export-button className="shrink-0">
          <Icon name="download" size={14} />
          {exporting ? t.exporting : status.kind === "failed" ? t.retry : t.export}
        </Button>
        {exporting ? (
          <p role="status" data-image-progress className="min-w-0 text-xs text-ink-2 tabular-nums">
            <span className="font-medium text-ink">{t.elapsed(elapsed)}</span> · {status.reused ? t.reused : t.working(status.width, status.height, status.furniture)}
          </p>
        ) : (
          <p className="text-xs text-ink-2 tabular-nums">{valid ? t.output(width * Number(scale), height * Number(scale)) : ""}</p>
        )}
      </div>
    </div>
  );
}
