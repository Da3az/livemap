import { PublishNotice } from "./publish-notice";
import { EngineNotice, RefusalNotice } from "./refusal-notice";
import { SaveNotice } from "./save-notice";

/**
 * Everything the editor has to say about saving, publishing, refused
 * commands and the map engine. It sits over the map directly under the Save
 * and Publish controls, never in a dialog, and nothing in it disappears on a
 * timer.
 */
export function MessageRail() {
  return (
    <div className="pointer-events-none absolute end-3 top-14 z-30 flex w-96 max-w-full flex-col gap-2 ps-6" aria-live="polite">
      <PublishNotice />
      <SaveNotice />
      <RefusalNotice />
      <EngineNotice />
    </div>
  );
}
