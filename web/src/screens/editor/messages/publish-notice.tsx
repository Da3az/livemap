import { Link } from "react-router";
import { useApi } from "@/app/providers";
import { useEditorStore, useEditorStoreApi, useRetryCountdown, type PublishState } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import { useEditorAccess } from "../shared/access";
import { Message, MESSAGE_LINK, MessageAction, Reason } from "./parts";

function RateLimited({ state, onRetry, onDismiss }: { state: Extract<PublishState, { kind: "rate_limited" }>; onRetry: () => void; onDismiss: () => void }) {
  const t = useEditorStrings();
  const seconds = useRetryCountdown(state.retryAt);
  return (
    <Message
      tone="warning"
      title={t.messages.rateLimitedTitle}
      onDismiss={onDismiss}
      actions={
        <MessageAction primary isDisabled={seconds > 0} onPress={onRetry}>
          {seconds > 0 ? <span className="tabular-nums">{t.messages.retryIn(seconds)}</span> : t.messages.publishAgain}
        </MessageAction>
      }
    >
      {t.messages.rateLimitedPublish}
    </Message>
  );
}

/** What publishing did, or why it did not, under the Publish control. */
export function PublishNotice() {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const api = useApi();
  const access = useEditorAccess();
  const publish = useEditorStore((state) => state.publish);
  const mapId = useEditorStore((state) => state.meta.id);
  const limits = useEditorStore((state) => state.access.limits);
  const dismiss = (): void => store.acknowledge();
  const retry = (): void => void store.publish(api);
  const versions = `/maps/${mapId}/versions`;

  switch (publish.kind) {
    case "idle":
    case "publishing":
    case "save_failed":
      return null;
    case "published":
      return (
        <Message
          tone="success"
          title={<span className="tabular-nums">{t.messages.publishedTitle(publish.version)}</span>}
          onDismiss={dismiss}
          actions={
            <Link to={`${versions}?view=${publish.version}`} className={MESSAGE_LINK}>
              <span className="tabular-nums">{t.messages.openVersion(publish.version)}</span>
            </Link>
          }
        >
          {t.messages.publishedBody}
        </Message>
      );
    case "unchanged":
      return (
        <Message tone="info" title={t.messages.unchangedTitle} onDismiss={dismiss}>
          <span className="tabular-nums">{t.messages.unchangedBody(publish.version)}</span>
        </Message>
      );
    case "quota_exceeded":
      return (
        <Message
          tone="danger"
          title={t.messages.quotaPublishTitle}
          onDismiss={dismiss}
          actions={
            <Link to={versions} className={MESSAGE_LINK}>
              {t.publish.history}
            </Link>
          }
        >
          <Reason reason={publish.reason} fallback={t.messages.quotaPublishBody(limits.maxVersionsPerMap)} />
        </Message>
      );
    case "rate_limited":
      return <RateLimited state={publish} onRetry={retry} onDismiss={dismiss} />;
    case "not_permitted":
      return (
        <Message tone="danger" title={t.messages.notPermittedPublishTitle} onDismiss={dismiss}>
          <Reason reason={publish.reason} fallback={t.messages.notPermittedBody(access.session.role)} />
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
              <MessageAction onPress={retry}>{t.messages.publishAgain}</MessageAction>
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
        <Message tone="warning" title={t.messages.offlineTitle} onDismiss={dismiss} actions={<MessageAction primary onPress={retry}>{t.messages.publishAgain}</MessageAction>}>
          {t.messages.offlinePublishBody}
        </Message>
      );
    case "unknown":
      return (
        <Message tone="danger" title={t.messages.unknownPublishTitle} onDismiss={dismiss} actions={<MessageAction primary onPress={retry}>{t.messages.publishAgain}</MessageAction>}>
          <Reason reason={publish.message} fallback={t.messages.unknownBody} />
        </Message>
      );
  }
}
