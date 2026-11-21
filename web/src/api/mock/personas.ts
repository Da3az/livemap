/** What only a mock can do: start as any persona, have a colleague save, run out a session. */
import type {
  RichText,
  TemplateSummary,
} from "@/model/types";
import { PEOPLE } from "./seed";
import {
  DEFAULT_SWITCHES,
  getWorld,
  type PersonaId,
  saveMeta,
} from "./world";

import {
  GUEST_LIFETIME_MS,
  nowIso,
  memberSession,
  startGuest,
  insertMap,
  type Dir,
} from "./server-rules";


const GUEST_FULL_TITLES: { title: RichText; uiDir: Dir; template: TemplateSummary["id"] }[] = [
  { title: { value: "Shamal dust storm over Kuwait and southern Iraq", dir: "ltr" }, uiDir: "ltr", template: "storm-track" },
  { title: { value: "أمطار جبال الحجر: كميات الهطول خلال 48 ساعة", dir: "rtl" }, uiDir: "rtl", template: "storm-track" },
  { title: { value: "Red Sea ferry routes, Jeddah to Port Sudan", dir: "ltr" }, uiDir: "ltr", template: "blank" },
  { title: { value: "انتخابات المجالس البلدية: النتائج الأولية", dir: "rtl" }, uiDir: "rtl", template: "regional-results" },
  { title: { value: "Doha marathon route and road closures", dir: "ltr" }, uiDir: "ltr", template: "blank" },
];

/** Put the mock into one of its named states. Leaves map data alone. */
export function applyPersona(persona: PersonaId): void {
  const world = getWorld();
  world.switches = { ...DEFAULT_SWITCHES, humanCheck: world.switches.humanCheck };
  world.persona = persona;

  switch (persona) {
    case "signed-out":
      world.session = null;
      break;
    case "owner":
      world.session = memberSession(PEOPLE.layla);
      break;
    case "admin":
      world.session = memberSession(PEOPLE.sarah);
      break;
    case "editor":
      world.session = memberSession(PEOPLE.omar);
      break;
    case "contributor":
      world.session = memberSession(PEOPLE.youssef);
      break;
    case "viewer":
      world.session = memberSession(PEOPLE.hannah);
      break;
    case "guest":
      startGuest(GUEST_LIFETIME_MS);
      break;
    case "guest-full": {
      const session = startGuest(GUEST_LIFETIME_MS);
      for (const input of GUEST_FULL_TITLES) insertMap(session, input);
      break;
    }
    case "guest-expired":
      startGuest(-60_000);
      break;
    case "guest-disabled":
      world.session = null;
      world.switches.guestSignup = false;
      break;
    case "guest-capacity":
      world.session = null;
      world.switches.guestCapacityFull = true;
      break;
    case "rate-limited":
      world.session = memberSession(PEOPLE.layla);
      world.switches.rateLimited = true;
      break;
  }
  saveMeta();
}

/**
 * Pretend a colleague saved the map: its revision moves on, so the next save
 * made against the old one is answered with `stale_revision`.
 */
export function simulateRemoteEdit(mapId: string, by: string = PEOPLE.sarah.name): boolean {
  const map = getWorld().maps.find((m) => m.doc.id === mapId);
  if (!map) return false;
  map.doc.rev += 1;
  map.doc.updatedAt = nowIso();
  map.doc.updatedBy = by;
  saveMeta();
  return true;
}

/** End the current session's life now; the next call is answered with 401. */
export function expireSession(): void {
  const world = getWorld();
  if (!world.session) return;
  world.session = { ...world.session, expiresAt: new Date(Date.now() - 1000).toISOString() };
  saveMeta();
}

/** What a forced `stale_revision` should report for a map. */
export function currentOf(mapId: string | undefined): { rev: number; updatedBy: string; updatedAt: string } {
  const map = mapId ? getWorld().maps.find((m) => m.doc.id === mapId) : undefined;
  return map
    ? { rev: map.doc.rev + 1, updatedBy: PEOPLE.sarah.name, updatedAt: nowIso() }
    : { rev: 2, updatedBy: PEOPLE.sarah.name, updatedAt: nowIso() };
}
