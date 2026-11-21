import { Suspense } from "react";
import { Link } from "react-router";
import { Icon } from "@/components/icons";
import { useEditorStore } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import { PreviewPanel } from "@/screens/editor/extras";
import { LeaveGuard } from "../messages/leave-guard";
import { MessageRail } from "../messages/message-rail";
import { ReadOnlyBar } from "../messages/read-only-bar";
import { useEditorUi } from "../shared/ui";
import { PublishControl } from "../topbar/publish-control";
import { TitleField } from "../topbar/title-field";
import { ModeSwitch, SaveControl } from "../topbar/save-control";

/**
 * The editor on a phone: look the map over, fix the title, see where saving
 * and publishing stand, publish, and reach preview and the version history.
 * There is no drawing here, and it says so.
 */
export function PhoneEditor({ mapRef }: { mapRef: (element: HTMLElement | null) => void }) {
  const t = useEditorStrings();
  const ui = useEditorUi();
  const rev = useEditorStore((state) => state.meta.rev);
  const count = useEditorStore((state) => state.doc.features.size);
  const ready = useEditorStore((state) => state.live.ready);

  return (
    <>
      <header className="flex shrink-0 flex-col gap-1 border-b border-rule bg-panel px-2 pt-1 pb-2">
        <div className="flex items-center gap-1">
          <Link to="/maps" className="flex h-11 shrink-0 items-center gap-1 rounded-field px-2 text-base font-medium text-ink-2">
            <Icon name="chevron" className="rotate-180 rtl:rotate-0" />
            {t.top.back}
          </Link>
          <span className="ms-auto me-2 font-title text-xs text-ink-3 tabular-nums italic">{t.top.revision(rev)}</span>
        </div>
        <TitleField className="h-11 text-lg" />
      </header>
      <ReadOnlyBar />
      <LeaveGuard />
      <main className="relative min-h-0 flex-1 bg-well">
        {/* While the preview is open this map is paused under it (see the shell). */}
        <div className="absolute inset-0" inert={ui.previewOpen}>
          <div ref={mapRef} data-editor-map className="size-full" />
        </div>
        {ready ? null : (
          <p role="status" className="absolute inset-x-0 top-1/2 text-center text-sm text-ink-3">
            {t.map.loading}
          </p>
        )}
        <MessageRail />
        {ui.previewOpen ? (
          <div className="absolute inset-0 z-40 bg-page">
            <Suspense fallback={null}>
              <PreviewPanel onClose={ui.closePreview} />
            </Suspense>
          </div>
        ) : null}
      </main>
      <footer className="flex shrink-0 flex-col gap-2 border-t border-rule bg-panel px-3 pt-2 pb-3">
        <div className="flex items-center gap-2">
          <SaveControl />
          <span className="flex-1" />
          <ModeSwitch />
        </div>
        <PublishControl />
        <p className="text-2xs text-ink-3">
          <span className="font-medium text-ink-2 tabular-nums">{t.status.features(count)}</span> · {t.phone.noDrawing}
        </p>
      </footer>
    </>
  );
}
