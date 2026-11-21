import { type FormEvent, lazy, type ReactNode, Suspense, useCallback, useId, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router";
import type { ApiError } from "@/api/client";
import { useConfig, useSession, useSignInAsGuest, useSignInWithToken } from "@/api/hooks";
import { AppHeader } from "@/components/app-header";
import { Notice } from "@/components/notice";
import { formatClock, useCountdown } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useShellStrings } from "@/i18n/shell";
import { HumanCheck } from "./human-check";

/* The specimen draws a map; MapLibre loads after the forms, not before them. */
const PublishedSpecimen = lazy(() => import("./specimen").then((module) => ({ default: module.PublishedSpecimen })));

/** The tokens the mock accepts, offered only in a development build. */
const DEV_TOKENS = ["mock-owner", "mock-admin", "mock-editor", "mock-contributor", "mock-viewer"];

const TOUCH_BUTTON = "max-md:h-10 max-md:px-4 max-md:text-base";
const TOUCH_INPUT = "max-md:h-10 max-md:text-lg";

function SkeletonLines({ label, widths }: { label: string; widths: string[] }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 py-1">
      <span className="sr-only" role="status">
        {label}
      </span>
      {widths.map((width, index) => (
        <span key={index} aria-hidden="true" className={`h-3 rounded-key bg-rule ${width}`} />
      ))}
    </div>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-4 gap-x-4 border-t border-rule py-1.5">
      <dt className="text-xs leading-5 text-ink-3">{term}</dt>
      <dd className="col-span-3 text-sm tabular-nums text-ink">{children}</dd>
    </div>
  );
}

/* --------------------------------------------------------------- guest */

function GuestSection({ loading }: { loading: boolean }) {
  const t = useShellStrings();
  const config = useConfig();
  const signIn = useSignInAsGuest();
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const [humanRound, setHumanRound] = useState(0);
  const [humanMissing, setHumanMissing] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waiting = useCountdown(waitUntil);
  const noticeId = useId();

  const onToken = useCallback((token: string | null) => {
    setHumanToken(token);
    setHumanMissing(false);
  }, []);

  if (loading || config.isPending) {
    return (
      <Section heading={t.signin.guestHeading}>
        <SkeletonLines label={t.signin.guestLoading} widths={["w-4/5", "w-full", "w-full", "w-3/5", "w-32"]} />
      </Section>
    );
  }

  if (config.isError) {
    return (
      <Section heading={t.signin.guestHeading}>
        <Notice
          tone="danger"
          title={t.signin.serverUnreachable}
          action={
            <Button variant="outline" className={TOUCH_BUTTON} isDisabled={config.isFetching} onPress={() => void config.refetch()}>
              {t.signin.retry}
            </Button>
          }
        >
          {config.error.reason ?? t.signin.serverUnreachableBody}
        </Notice>
      </Section>
    );
  }

  const error = signIn.error;
  if (!config.data.guestSignup || error?.code === "guest_signup_disabled") {
    return (
      <Section heading={t.signin.guestOffHeading}>
        <p className="max-w-md text-base text-ink-2">{t.signin.guestOffBody}</p>
      </Section>
    );
  }

  const siteKey = config.data.humanCheckSiteKey;
  const terms = config.data.guest;
  const held = waiting > 0;

  const start = (): void => {
    if (siteKey !== null && humanToken === null) {
      setHumanMissing(true);
      return;
    }
    setWaitUntil(null);
    signIn.mutate(humanToken === null ? {} : { humanCheckToken: humanToken }, {
      onError: (failure) => {
        if (failure.retryAfter !== null) setWaitUntil(Date.now() + failure.retryAfter * 1000);
        if (failure.code === "human_check_failed") {
          setHumanToken(null);
          setHumanRound((round) => round + 1);
        }
      },
    });
  };

  return (
    <Section heading={t.signin.guestHeading}>
      <p className="text-base text-ink-2">{t.signin.guestLead}</p>
      {terms ? (
        <dl className="mt-3 border-b border-rule">
          <Fact term={t.signin.factLasts}>{t.signin.factLastsValue(terms.lifetimeHours)}</Fact>
          <Fact term={t.signin.factHolds}>{t.signin.factHoldsValue(terms.maxMaps)}</Fact>
          <Fact term={t.signin.factEach}>{t.signin.factEachValue(terms.maxFeaturesPerMap, terms.maxVersionsPerMap)}</Fact>
          <Fact term={t.signin.factAfter}>{t.signin.factAfterValue}</Fact>
        </dl>
      ) : null}

      {siteKey !== null ? (
        <div className="mt-5">
          <HumanCheck key={humanRound} siteKey={siteKey} invalid={humanMissing} onToken={onToken} />
          {humanMissing ? (
            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {t.signin.humanNeeded}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3">
        <div>
          <Button size="lg" className={TOUCH_BUTTON} isDisabled={signIn.isPending || held} aria-describedby={error ? noticeId : undefined} onPress={start}>
            {signIn.isPending ? t.signin.guestStarting : error && !held ? t.signin.retry : t.signin.guestButton}
          </Button>
        </div>
        {error && !signIn.isPending ? (
          <div id={noticeId}>
            <GuestRefusal error={error} waiting={waiting} />
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function GuestRefusal({ error, waiting }: { error: ApiError; waiting: number }) {
  const t = useShellStrings();
  const clock = <span className="font-semibold tabular-nums text-ink">{formatClock(waiting)}</span>;
  switch (error.code) {
    case "guest_capacity":
      return (
        <Notice tone="warning" title={t.signin.capacityTitle}>
          {waiting > 0 ? <Clocked text={t.signin.capacityBody("{clock}")} clock={clock} /> : t.signin.capacityReady}
        </Notice>
      );
    case "rate_limited":
      return (
        <Notice tone="warning" title={t.signin.rateTitle}>
          {waiting > 0 ? <Clocked text={t.signin.rateBody("{clock}")} clock={clock} /> : t.signin.rateReady}
        </Notice>
      );
    case "network":
      return (
        <Notice tone="danger" title={t.signin.networkTitle}>
          {t.signin.networkBody}
        </Notice>
      );
    case "human_check_failed":
      return (
        <Notice tone="danger" title={t.signin.humanFailedTitle}>
          {t.signin.humanFailedBody}
        </Notice>
      );
    default:
      return (
        <Notice tone="danger" title={t.signin.otherTitle}>
          {error.reason}
        </Notice>
      );
  }
}

/** A sentence with a live clock set into it, so the figure can keep tabular numerals and its own weight. */
function Clocked({ text, clock }: { text: string; clock: ReactNode }) {
  const [before = "", after = ""] = text.split("{clock}");
  return (
    <span aria-live="off">
      {before}
      {clock}
      {after}
    </span>
  );
}

/* --------------------------------------------------------------- token */

function TokenSection({ loading, primary }: { loading: boolean; primary: boolean }) {
  const t = useShellStrings();
  const signIn = useSignInWithToken();
  const [token, setToken] = useState("");
  const [empty, setEmpty] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const errorId = useId();

  if (loading) {
    return (
      <Section heading={t.signin.tokenHeading}>
        <SkeletonLines label={t.signin.checkingSession} widths={["w-4/5", "w-full", "w-24"]} />
      </Section>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (token.trim().length === 0) {
      setEmpty(true);
      inputRef.current?.focus();
      return;
    }
    signIn.mutate(token, { onError: () => inputRef.current?.focus() });
  };

  const error = signIn.isPending ? null : signIn.error;
  const rejected = error?.code === "unauthorised";

  return (
    <Section heading={t.signin.tokenHeading}>
      <p className="text-base text-ink-2">{t.signin.tokenLead}</p>
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-xs font-medium text-ink-2">
            {t.signin.tokenLabel}
          </label>
          <Input
            ref={inputRef}
            id={fieldId}
            type="text"
            name="session-token"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={token}
            aria-invalid={rejected || empty || undefined}
            aria-describedby={error || empty ? errorId : undefined}
            onChange={(event) => {
              setToken(event.target.value);
              setEmpty(false);
            }}
            className={`tabular-nums ${TOUCH_INPUT}`}
          />
          {empty ? (
            <p id={errorId} role="alert" className="text-xs font-medium text-danger">
              {t.signin.tokenEmpty}
            </p>
          ) : null}
        </div>
        <div>
          <Button type="submit" variant={primary ? "default" : "outline"} size="lg" className={TOUCH_BUTTON} isDisabled={signIn.isPending}>
            {signIn.isPending ? t.signin.tokenSigningIn : t.signin.tokenButton}
          </Button>
        </div>
        {error ? (
          <div id={errorId}>
            {rejected ? (
              <Notice tone="danger" title={t.signin.tokenRejectedTitle}>
                {t.signin.tokenRejectedBody}
              </Notice>
            ) : error.code === "network" ? (
              <Notice tone="danger" title={t.signin.networkTitle}>
                {t.signin.serverUnreachableBody}
              </Notice>
            ) : (
              <Notice tone={error.code === "rate_limited" ? "warning" : "danger"} title={t.signin.tokenOtherTitle}>
                {error.reason}
              </Notice>
            )}
          </div>
        ) : null}
      </form>

      {import.meta.env.DEV ? (
        <div className="mt-6 border-t border-dashed border-rule-strong pt-3">
          <p className="text-xs text-ink-3">{t.signin.devHint}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {DEV_TOKENS.map((name) => (
              <li key={name}>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t.signin.devUse(name)}
                  onPress={() => {
                    setToken(name);
                    setEmpty(false);
                    inputRef.current?.focus();
                  }}
                >
                  {name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <>
      <h2 className="font-title text-lg font-medium text-ink">{heading}</h2>
      <div className="mt-2">{children}</div>
    </>
  );
}

/* ------------------------------------------------------------ specimen */

/** One published map, shown read-only so the front door shows what the tool makes. */
/* ---------------------------------------------------------------- page */

function readNotice(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("notice" in state)) return null;
  return typeof state.notice === "string" ? state.notice : null;
}

export default function SignIn() {
  const t = useShellStrings();
  const session = useSession();
  const config = useConfig();
  const location = useLocation();

  if (session.isSuccess) return <Navigate to="/maps" replace />;

  const ended = readNotice(location.state);
  const unreachable = session.isError && session.error.code !== "unauthorised" ? session.error : null;
  const guestOff = config.isSuccess && !config.data.guestSignup;

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <AppHeader />
      <div className="flex flex-1">
        <main className="min-w-0 flex-1 bg-panel px-4 pt-8 pb-12 md:px-10 md:pt-14 xl:px-16">
          <div className="max-w-5xl xl:max-w-none">
            <h1 className="max-w-xl font-title text-xl font-medium text-ink">{t.signin.product}</h1>

            {ended ? (
              <Notice tone="info" title={t.signin.expired} className="mt-6 max-w-2xl">
                {ended}
              </Notice>
            ) : null}
            {unreachable ? (
              <Notice
                tone="danger"
                title={t.signin.serverUnreachable}
                className="mt-6 max-w-2xl"
                action={
                  <Button variant="outline" className={TOUCH_BUTTON} isDisabled={session.isFetching} onPress={() => void session.refetch()}>
                    {t.signin.retry}
                  </Button>
                }
              >
                {t.signin.serverUnreachableBody}
              </Notice>
            ) : null}

            {/* From 1280 px the forms stack in one column and the published map takes the rest of the width beside them. */}
            <div className="xl:grid xl:grid-cols-12 xl:gap-x-14">
              <div className="mt-8 grid border-t border-rule-strong md:mt-10 md:grid-cols-12 xl:col-span-5 xl:grid-cols-1">
                <section className="py-6 md:col-span-7 md:border-e md:border-rule md:pe-10 xl:col-span-1 xl:border-e-0 xl:pe-0">
                  <GuestSection loading={session.isPending} />
                </section>
                <section className="border-t border-rule py-6 md:col-span-5 md:border-t-0 md:ps-10 xl:col-span-1 xl:border-t xl:ps-0">
                  <TokenSection loading={session.isPending} primary={guestOff} />
                </section>
              </div>
              <div className="xl:col-span-7">
                <Suspense fallback={<div aria-hidden="true" className="mt-10 h-80 border-t border-rule-strong md:h-96 xl:h-128" />}>
                  <PublishedSpecimen />
                </Suspense>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
