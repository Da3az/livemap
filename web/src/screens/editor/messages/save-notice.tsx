import { Link } from "react-router";
import { useApi } from "@/app/providers";
import { useEditorStore, useEditorStoreApi, useRetryCountdown, type SaveState } from "@/editor/store";
import { useLang } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";
import { formatRecent } from "../shared/format";
import { useEditorAccess } from "../shared/access";
import { Message, MESSAGE_LINK, MessageAction, Reason } from "./parts";

function RateLimited({ state, onRetry, onDismiss }: { state: Extract<SaveState, { kind: "rate_limited" }>; onRetry: () => void; onDismiss: () => void }) {
  const t = useEditorStrings();
  const seconds = useRetryCountdown(state.retryAt);
  return (
    <Message
      tone="warning"
      title={t.messages.rateLimitedTitle}
      onDismiss={onDismiss}
      actions={
        <MessageAction primary isDisabled={seconds > 0} onPress={onRetry}>
          {seconds > 0 ? <span className="tabular-nums">{t.messages.retryIn(seconds)}</span> : t.messages.saveAgain}
        </MessageAction>
      }
    >
      {t.messages.rateLimitedSave}
    </Message>
  );
}

/** Why a save did not go through and what to do about it, under the Save control. */
export function SaveNotice() {
  const t = useEditorStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const api = useApi();
  const access = useEditorAccess();
  const save = useEditorStore((state) => state.save);
  const limits = useEditorStore((state) => state.access.limits);
  const dismiss = (): void => store.acknowledge();
  const retry = (): void => void store.save(api);

  switch (save.kind) {
    case "idle":
    case "saving":
    case "saved":
    case "nothing_to_save":
      return null;
    case "stale":
      return (
        <Message
          tone="warning"
          title={save.current ? t.messages.staleTitle(save.current.updatedBy, formatRecent(save.current.updatedAt, lang)) : t.messages.staleTitleUnknown}
          actions={
            <>
              <MessageAction primary onPress={() => void store.reloadTheirs(api)}>
                {t.messages.loadTheirs}
              </MessageAction>
              <MessageAction onPress={() => void store.save(api, { force: true })}>{t.messages.keepMine}</MessageAction>
            </>
          }
        >
          {t.messages.staleBody}
        </Message>
      );
    case "quota_exceeded":
      return (
        <Message tone="danger" title={t.messages.quotaSaveTitle} onDismiss={dismiss}>
          <Reason reason={save.reason} fallback={t.messages.quotaSaveBody(limits.maxFeaturesPerMap)} />
        </Message>
      );
    case "rate_limited":
      return <RateLimited state={save} onRetry={retry} onDismiss={dismiss} />;
    case "not_permitted":
      return (
        <Message tone="danger" title={t.messages.notPermittedSaveTitle} onDismiss={dismiss}>
          <Reason reason={save.reason} fallback={t.messages.notPermittedBody(access.session.role)} />
        </Message>
      );
    case "signed_out":
      return (
        <Message
          tone="danger"
          title={t.messages.signedOutTitle}
          onDismiss={dismiss}
          actions={
            <>
              <MessageAction onPress={retry}>{t.messages.saveAgain}</MessageAction>
              <Link to="/" target="_blank" rel="noreferrer" className={MESSAGE_LINK}>
                {t.messages.signInNewTab}
              </Link>
            </>
          }
        >
          {t.messages.signedOutBody}
        </Message>
      );
    case "offline":
      return (
        <Message tone="warning" title={t.messages.offlineTitle} onDismiss={dismiss} actions={<MessageAction primary onPress={retry}>{t.messages.saveAgain}</MessageAction>}>
          {t.messages.offlineBody}
        </Message>
      );
    case "too_large":
      return (
        <Message tone="danger" title={t.messages.tooLargeTitle} onDismiss={dismiss}>
          {t.messages.tooLargeBody(save.featureCount)}
        </Message>
      );
    case "unknown":
      return (
        <Message tone="danger" title={t.messages.unknownSaveTitle} onDismiss={dismiss} actions={<MessageAction primary onPress={retry}>{t.messages.saveAgain}</MessageAction>}>
          <Reason reason={save.message} fallback={t.messages.unknownBody} />
        </Message>
      );
  }
}
