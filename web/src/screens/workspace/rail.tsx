import type { ReactNode } from "react";
import { StateBadge } from "@/components/state-badge";
import { formatDayAndTime, formatUntil, useNow } from "@/components/time";
import { Kbd } from "@/components/ui/kbd";
import { useLang } from "@/i18n";
import { useShellStrings } from "@/i18n/shell";
import type { Session } from "@/model/types";
import { isNear } from "./model";

export interface ViewCounts {
  active: number | null;
  archived: number | null;
}

/* ---------------------------------------------------------------- usage */

type UsageTone = "plain" | "near" | "full";

export function usageTone(session: Session): UsageTone {
  const { maps } = session.usage;
  const { maxMaps } = session.limits;
  if (maps >= maxMaps) return "full";
  return isNear(maps, maxMaps) ? "near" : "plain";
}

const TONE_TEXT: Record<UsageTone, string> = { plain: "text-ink", near: "text-warning", full: "text-danger" };
const TONE_FILL: Record<UsageTone, string> = { plain: "bg-ink-2", near: "bg-warning", full: "bg-danger" };

/** "4 of 5 · 1 left": exact, and worded so the colour is never the only signal. */
export function UsageReadout({ session, className }: { session: Session; className?: string }) {
  const t = useShellStrings();
  const tone = usageTone(session);
  const { maps } = session.usage;
  const { maxMaps } = session.limits;
  return (
    <span className={`font-medium tabular-nums ${TONE_TEXT[tone]} ${className ?? ""}`}>
      {t.ws.usageOf(maps, maxMaps)}
      {tone === "near" ? ` · ${t.ws.usageLeft(maxMaps - maps)}` : ""}
      {tone === "full" ? ` · ${t.ws.usageFull}` : ""}
    </span>
  );
}

/** The quota drawn the way a map draws a distance: a ruled bar with its figures underneath. */
function UsageScale({ session }: { session: Session }) {
  const { maps } = session.usage;
  const { maxMaps } = session.limits;
  const divisions = maxMaps <= 10 ? maxMaps : 4;
  const ticks = Array.from({ length: Math.max(0, divisions - 1) }, (_, index) => ((index + 1) / divisions) * 100);
  const filled = Math.min(100, (maps / maxMaps) * 100);
  const middle = maxMaps % 2 === 0 && maxMaps > 2 ? maxMaps / 2 : null;
  return (
    <div aria-hidden="true" className="mt-2">
      <div className="relative h-2 border border-ink-3 bg-panel">
        <div className={`h-full ${TONE_FILL[usageTone(session)]}`} style={{ inlineSize: `${filled}%` }} />
        {ticks.map((at) => (
          <span key={at} className="absolute inset-y-0 w-px bg-ink-3" style={{ insetInlineStart: `${at}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-2xs tabular-nums text-ink-3">
        <span>0</span>
        {middle !== null ? <span>{middle}</span> : null}
        <span>{maxMaps}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- notes */

export function roleNote(session: Session, t: ReturnType<typeof useShellStrings>): string | null {
  if (session.guest) return null;
  if (!session.capabilities.includes("map:create")) return t.ws.roleViewer;
  if (session.role === "contributor") return t.ws.roleContributor;
  if (!session.capabilities.includes("map:archive")) return t.ws.roleEditor;
  return null;
}

/** When a guest workspace goes, as a date and as time left; the time left stays true while it is on screen. */
export function GuestExpiry({ expiresAt }: { expiresAt: string }) {
  const t = useShellStrings();
  const lang = useLang();
  const left = Date.parse(expiresAt) - Date.now();
  const now = useNow(left < 2 * 60_000 ? 1000 : 20_000);
  return (
    <span className="tabular-nums">
      {t.ws.guestBody(formatDayAndTime(expiresAt, lang))} <span className="font-semibold text-ink">({formatUntil(expiresAt, now, t.time)})</span>
    </span>
  );
}

/* ----------------------------------------------------------------- keys */

function KeyRow({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <dt className="text-xs text-ink-2">{children}</dt>
      <dd className="flex gap-1">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </dd>
    </div>
  );
}

/* ----------------------------------------------------------------- rail */

function RailSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="border-b border-rule px-4 py-4">
      <h2 className="text-xs font-semibold text-plum">{heading}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ViewButton({ selected, count, onPress, children }: { selected: boolean; count: number | null; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      onClick={onPress}
      className={`flex h-row w-full items-center justify-between rounded-block border px-2.5 text-sm transition-colors duration-100 ${
        selected ? "border-survey bg-panel font-medium text-ink" : "border-transparent text-ink-2 hover:bg-well hover:text-ink"
      }`}
    >
      <span>{children}</span>
      <span className="text-xs tabular-nums text-ink-3">{count ?? "–"}</span>
    </button>
  );
}

/**
 * The leading pane on a wide window: which view of the table, how much of the
 * quota is used, what this session may do (said once, here), and the keys.
 */
export function Rail({
  session,
  archivedView,
  counts,
  canCreate,
  onView,
}: {
  session: Session;
  archivedView: boolean;
  counts: ViewCounts;
  canCreate: boolean;
  onView: (archived: boolean) => void;
}) {
  const t = useShellStrings();
  const tone = usageTone(session);
  const note = roleNote(session, t);
  const left = session.limits.maxMaps - session.usage.maps;

  return (
    <aside className="hidden w-list shrink-0 flex-col overflow-y-auto border-e border-rule bg-page xl:flex">
      <nav aria-label={t.ws.views} className="flex flex-col gap-0.5 border-b border-rule px-2 py-3">
        <ViewButton selected={!archivedView} count={counts.active} onPress={() => onView(false)}>
          {t.ws.active}
        </ViewButton>
        <ViewButton selected={archivedView} count={counts.archived} onPress={() => onView(true)}>
          {t.ws.archived}
        </ViewButton>
      </nav>

      <RailSection heading={t.ws.usage}>
        <UsageReadout session={session} className="text-base" />
        <UsageScale session={session} />
        <p className={`mt-2 text-xs ${tone === "plain" ? "text-ink-3" : "text-ink-2"}`}>
          {tone === "near" ? `${t.ws.nearTitle(left)}. ` : ""}
          {tone === "full" ? `${t.ws.fullBody}` : t.ws.usageArchivedNote}
        </p>
      </RailSection>

      {session.guest && session.expiresAt ? (
        <section className="border-b border-rule px-4 py-4">
          <StateBadge state="guest">{t.ws.guestTitle}</StateBadge>
          <p className="mt-2 text-xs text-ink-2">
            <GuestExpiry expiresAt={session.expiresAt} />
          </p>
          <p className="mt-1 text-xs tabular-nums text-ink-3">
            {t.ws.guestLimits(session.limits.maxMaps, session.limits.maxFeaturesPerMap, session.limits.maxVersionsPerMap)}
          </p>
        </section>
      ) : null}

      {note ? (
        <RailSection heading={t.ws.roleHeading}>
          {!session.capabilities.includes("map:create") ? <StateBadge state="readonly">{t.ws.readOnly}</StateBadge> : null}
          <p className="mt-1 text-xs text-ink-2">{note}</p>
        </RailSection>
      ) : null}

      <section className="mt-auto px-4 py-4">
        <h2 className="text-xs font-semibold text-plum">{t.ws.keysHeading}</h2>
        <dl className="mt-2">
          <KeyRow keys={["↑", "↓"]}>{t.ws.keyMove}</KeyRow>
          <KeyRow keys={["Enter"]}>{t.ws.keyOpen}</KeyRow>
          <KeyRow keys={["V"]}>{t.ws.keyVersions}</KeyRow>
          {canCreate ? <KeyRow keys={["N"]}>{t.ws.keyNew}</KeyRow> : null}
          <KeyRow keys={["/"]}>{t.ws.keySearch}</KeyRow>
          <KeyRow keys={["Esc"]}>{t.ws.keyEsc}</KeyRow>
        </dl>
      </section>
    </aside>
  );
}

/** The same notes as the rail, as lines above the table, for windows too narrow for the rail. */
export function NarrowNotes({ session }: { session: Session }) {
  const t = useShellStrings();
  const tone = usageTone(session);
  const note = roleNote(session, t);
  const left = session.limits.maxMaps - session.usage.maps;
  const guest = session.guest && session.expiresAt !== null;
  if (!guest && !note && tone !== "near") return null;

  return (
    <div className="flex flex-col gap-1.5 border-b border-rule bg-page px-4 py-2 text-xs text-ink-2 md:px-5 xl:hidden">
      {session.guest && session.expiresAt ? (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <StateBadge state="guest">{t.ws.guestTitle}</StateBadge>
          <GuestExpiry expiresAt={session.expiresAt} />
        </p>
      ) : null}
      {tone === "near" ? (
        <p role="status" className="font-medium text-warning">
          {t.ws.nearTitle(left)}. <span className="font-normal text-ink-2">{t.ws.usageArchivedNote}</span>
        </p>
      ) : null}
      {note ? (
        <p className="flex flex-wrap items-baseline gap-x-2">
          {!session.capabilities.includes("map:create") ? <StateBadge state="readonly">{t.ws.readOnly}</StateBadge> : null}
          <span>{note}</span>
        </p>
      ) : null}
    </div>
  );
}
