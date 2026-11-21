import { Notice } from "@/components/notice";
import { useEditorStore } from "@/editor/store";
import { useExtrasStrings } from "@/i18n/editor-extras";
import { BasemapSection } from "./basemap-section";
import { EmbedSection, ReaderTimelineSection } from "./embed-section";
import { LegendSection } from "./legend-section";
import { PresetsSection } from "./presets-section";
import { DocumentSection } from "./document-section";
import { OpeningViewSection } from "./view-section";

/**
 * The map's own settings, shown in the trailing pane when nothing is
 * selected. It opens on the map's own document, a miniature of what is
 * printed around it that is edited line by line; then what its styles mean,
 * what it sits on, what readers open on, and how it behaves in an article.
 * Each section folds and remembers it. Every change is a store command,
 * so it can be undone and marks the map unsaved.
 */
export function MapSettingsPanel() {
  const t = useExtrasStrings().settings;
  const readOnly = useEditorStore((state) => state.access.readOnly);
  const disabled = readOnly !== null;
  return (
    <div data-map-settings className="relative flex flex-col bg-panel text-ink">
      {disabled ? (
        <Notice tone="info" title={t.readOnlyTitle} className="m-3 mb-0">
          {readOnly === "archived" ? t.readOnlyArchived : t.readOnlyViewer}
        </Notice>
      ) : null}
      <DocumentSection disabled={disabled} />
      <LegendSection disabled={disabled} />
      <PresetsSection disabled={disabled} />
      <BasemapSection disabled={disabled} />
      <OpeningViewSection disabled={disabled} />
      <EmbedSection disabled={disabled} />
      <ReaderTimelineSection disabled={disabled} />
    </div>
  );
}
