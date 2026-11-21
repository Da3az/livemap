import { useEffect } from "react";
import { useEditorStore, useEditorStoreApi, type Refusal } from "@/editor/store";
import { useEditorStrings, type EditorStrings } from "@/i18n/editor";
import { useEditorAccess, type ReadOnlyWhy } from "../shared/access";
import { useEditorUi } from "../shared/ui";
import { Message, MessageAction } from "./parts";

function wording(t: EditorStrings, refusal: Refusal, why: ReadOnlyWhy | null): { title: string; body?: string } | null {
  switch (refusal.code) {
    case "read_only":
      return { title: t.refusals.readOnly, body: t.readOnly.short[why ?? refusal.why] };
    case "feature_limit":
      return { title: t.refusals.featureLimit(refusal.max), body: t.refusals.featureLimitBody };
    case "locked":
      return { title: t.refusals.locked, body: t.refusals.lockedBody };
    case "no_playhead":
      return { title: t.refusals.noPlayhead, body: t.refusals.noPlayheadBody };
    case "empty_clipboard":
      return { title: t.refusals.emptyClipboard };
    case "invalid":
      return { title: t.refusals.invalid, body: refusal.detail };
    case "not_found":
      return { title: t.refusals.notFound };
    case "no_target":
      return null;
  }
}

/** A command the editor declined, said once and plainly. It clears itself when the next edit succeeds. */
export function RefusalNotice() {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const access = useEditorAccess();
  const entry = useEditorStore((state) => state.refusal);
  const doc = useEditorStore((state) => state.doc);

  useEffect(() => store.dismissRefusal(), [store, doc]);

  if (entry === null) return null;
  const words = wording(t, entry.refusal, access.why);
  if (words === null) return null;
  return (
    <Message key={entry.seq} tone={entry.refusal.code === "feature_limit" ? "danger" : "info"} title={words.title} onDismiss={() => store.dismissRefusal()}>
      {words.body ? <span dir="auto">{words.body}</span> : null}
    </Message>
  );
}

/** A problem the map engine reported: tiles that did not arrive, a shape it could not keep, a lost graphics context. */
export function EngineNotice() {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const ui = useEditorUi();
  const problem = useEditorStore((state) => state.live.problem);
  if (problem === null) return null;
  const dismiss = (): void => store.setEngineProblem(null);

  if (problem.code === "context_lost") {
    return (
      <Message tone="danger" title={t.engine.contextLostTitle} actions={<MessageAction primary onPress={ui.reloadMap}>{t.engine.reloadMap}</MessageAction>}>
        {t.engine.contextLostBody}
      </Message>
    );
  }
  if (problem.code === "tiles_failed") {
    return (
      <Message tone="warning" title={t.engine.tilesTitle} onDismiss={dismiss} actions={<MessageAction onPress={ui.reloadMap}>{t.engine.tryAgain}</MessageAction>}>
        {t.engine.tilesBody}
      </Message>
    );
  }
  return (
    <Message tone="info" title={t.engine.shapeTitle} onDismiss={dismiss}>
      {t.engine.shapeBody}
    </Message>
  );
}
