import type { LngLat } from "@/model/types";

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

function normalise(text: string): string {
  let out = "";
  for (const char of text) {
    const western = ARABIC_INDIC.indexOf(char);
    const eastern = EASTERN_ARABIC_INDIC.indexOf(char);
    if (western >= 0) out += String(western);
    else if (eastern >= 0) out += String(eastern);
    else out += char;
  }
  return out
    .replace(/٫/g, ".")
    .replace(/[،;]/g, ",")
    .replace(/[−–—]/g, "-")
    .replace(/شمال(?:اً|ًا|ا)?/g, " N ")
    .replace(/جنوب(?:اً|ًا|ا)?/g, " S ")
    .replace(/شرق(?:اً|ًا|ا)?/g, " E ")
    .replace(/غرب(?:اً|ًا|ا)?/g, " W ")
    .toUpperCase()
    .replace(/\b(NORTH|SOUTH|EAST|WEST)\b/g, (word) => word.charAt(0));
}

function valid(lat: number, lng: number): LngLat | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

function pair(text: string | null | undefined): LngLat | null {
  if (text === null || text === undefined) return null;
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(text);
  if (match === null) return null;
  return valid(Number(match[1]), Number(match[2]));
}

/** Coordinates inside a Google Maps link: the pin (`!3d…!4d…`), then a query, then the view centre (`@…`). */
function fromMapsUrl(text: string): LngLat | null {
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(text);
  if (pin !== null) return valid(Number(pin[1]), Number(pin[2]));
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  for (const key of ["q", "query", "ll", "center", "destination", "daddr"]) {
    const found = pair(url.searchParams.get(key)?.replace(/^loc:/i, ""));
    if (found !== null) return found;
  }
  const view = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  if (view !== null) return valid(Number(view[1]), Number(view[2]));
  const place = /\/(?:place|search|dir)\/(-?\d+(?:\.\d+)?),\+?(-?\d+(?:\.\d+)?)/.exec(decodeURIComponent(url.pathname));
  return place === null ? null : valid(Number(place[1]), Number(place[2]));
}

type Token = { letter: "N" | "S" | "E" | "W" } | { number: number; negative: boolean };

/** Degrees from up to three numbers: degrees, minutes, seconds. */
function degrees(parts: readonly { number: number; negative: boolean }[]): number | null {
  const [deg, min, sec] = parts;
  if (deg === undefined || parts.length > 3) return null;
  if ((min !== undefined && (min.negative || min.number >= 60)) || (sec !== undefined && (sec.negative || sec.number >= 60))) {
    return null;
  }
  const magnitude = deg.number + (min?.number ?? 0) / 60 + (sec?.number ?? 0) / 3600;
  return deg.negative ? -magnitude : magnitude;
}

/**
 * Read coordinates a person pasted into place search. Returns `[lng, lat]`, or
 * null when the text is not coordinates (so it is searched as a name).
 *
 * Understands decimal degrees ("23.85, 57.44": latitude first, unless the
 * first number can only be a longitude), degrees-minutes-seconds
 * ("23°51'N 57°26'E", "23 51 30 N, 57 26 0 E"), hemisphere letters or words in
 * either position and either order ("57.44 E 23.85 N", "N 23.85 E 57.44"),
 * Arabic-Indic digits and Arabic direction words, and Google Maps links.
 */
export function parseCoordinates(input: string): LngLat | null {
  const raw = input.trim();
  if (raw === "") return null;
  if (/^https?:\/\//i.test(raw)) return fromMapsUrl(raw);

  const text = normalise(raw);
  if (/[^0-9NSEW\s.,+\-°º′'’″"”:]/.test(text)) return null;
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[NSEW]|[-+]?\d+(?:\.\d+)?/g)) {
    const value = match[0];
    if (value === "N" || value === "S" || value === "E" || value === "W") tokens.push({ letter: value });
    else tokens.push({ number: Math.abs(Number(value)), negative: value.startsWith("-") });
  }
  const letters = tokens.filter((token) => "letter" in token);
  const numbers = tokens.filter((token) => "number" in token);

  if (letters.length === 0) {
    if (numbers.length !== 2 && numbers.length !== 4 && numbers.length !== 6) return null;
    const half = numbers.length / 2;
    const first = degrees(numbers.slice(0, half));
    const second = degrees(numbers.slice(half));
    if (first === null || second === null) return null;
    return Math.abs(first) > 90 && Math.abs(second) <= 90 ? valid(second, first) : valid(first, second);
  }

  if (letters.length !== 2) return null;
  const leading = tokens[0] !== undefined && "letter" in tokens[0];
  const groups: { letter: "N" | "S" | "E" | "W"; parts: { number: number; negative: boolean }[] }[] = [];
  let open: { number: number; negative: boolean }[] = [];
  for (const token of tokens) {
    if ("number" in token) {
      if (leading) {
        const group = groups[groups.length - 1];
        if (group === undefined) return null;
        group.parts.push(token);
      } else {
        open.push(token);
      }
    } else if (leading) {
      groups.push({ letter: token.letter, parts: [] });
    } else {
      groups.push({ letter: token.letter, parts: open });
      open = [];
    }
  }
  if (open.length > 0) return null;

  let lat: number | null = null;
  let lng: number | null = null;
  for (const group of groups) {
    const value = degrees(group.parts);
    if (value === null) return null;
    const signed = group.letter === "S" || group.letter === "W" ? -Math.abs(value) : value;
    if (group.letter === "N" || group.letter === "S") {
      if (lat !== null) return null;
      lat = signed;
    } else {
      if (lng !== null) return null;
      lng = signed;
    }
  }
  return lat === null || lng === null ? null : valid(lat, lng);
}

/** Coordinates as text for the status bar and for copying: "23.85000, 57.44000" (latitude first). */
export function formatCoordinates(at: LngLat, digits = 5): string {
  return `${at[1].toFixed(digits)}, ${at[0].toFixed(digits)}`;
}
