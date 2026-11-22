import type { SVGProps } from "react";

/**
 * The drawn icon set: 16px grid, 1.4px stroke, fills only to carry a colour.
 * Icons are used where a word will not fit or where the shape is the
 * information (feature kinds, states). Commands use words.
 */
const PATHS = {
  /* tools and feature kinds */
  select: <path d="M3 2l9.5 5.2-4 1.3-1.6 4L3 2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  area: <path d="M3 5l5-2.5 5 3-1.5 7H4.5z" fill="currentColor" fillOpacity=".3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  line: <path d="M2.5 12l4-6 3 3 4-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />,
  arrow: (
    <>
      <path d="M2.5 12.5C4 7 7.5 4.5 12 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9.5 2.5l3.5 2-2.6 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  frontline: (
    <>
      <path d="M1.5 11h13" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 11l1.8-3.5L6.6 11zM7.2 11L9 7.5l1.8 3.5zM11.2 11L13 7.5V11z" />
    </>
  ),
  point: (
    <>
      <circle cx="8" cy="8" r="5.2" fill="currentColor" fillOpacity=".3" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.6" />
    </>
  ),
  annotation: <path d="M3.5 4h9M8 4v9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
  group: <path d="M2 4.5h4.2l1.3 1.6H14v6.4H2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  /* row controls */
  grip: (
    <>
      <circle cx="6" cy="4" r="1" />
      <circle cx="10" cy="4" r="1" />
      <circle cx="6" cy="8" r="1" />
      <circle cx="10" cy="8" r="1" />
      <circle cx="6" cy="12" r="1" />
      <circle cx="10" cy="12" r="1" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="1.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  unlock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.6-1.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
  chevron: <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  chevronDown: <path d="M3.5 6L8 10.5 12.5 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  /* map movement: geographic directions, never mirrored */
  panUp: <path d="M3.5 10L8 5.5 12.5 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  panDown: <path d="M3.5 6L8 10.5 12.5 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  panLeft: <path d="M10 3.5L5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  panRight: <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  recentre: (
    <>
      <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  fullscreen: <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />,
  exitFullscreen: <path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />,
  pen: <path d="M3 13l1-3.5 7-7 2.5 2.5-7 7zM9.5 4l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  crosshair: <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />,
  /* a closed list of choices: the value can go either way */
  upDown: <path d="M5 6.3l3-3 3 3M5 9.7l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />,
  check: <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  close: <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  /* the reader's map and the versions screen */
  plus: <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  minus: <path d="M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  play: <path d="M5 3.2v9.6L12.8 8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />,
  pause: <path d="M5.2 3.5v9M10.8 3.5v9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 3.5v-1h-8v8h1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </>
  ),
  external: <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  /* the editor's secondary panels */
  stepNext: (
    <>
      <path d="M3.5 3.5v9L10 8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M12 3.5v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </>
  ),
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.5M9.2 7v3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  download: <path d="M8 2.5v7.5M5 7.2L8 10l3-2.8M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />,
  upload: <path d="M8 10V2.5M5 5.3L8 2.5l3 2.8M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />,
  /* states: the shape is the signal, colour only reinforces it */
  stateDraft: <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" />,
  stateUnsaved: <path d="M8 2.5L13.5 8 8 13.5 2.5 8z" />,
  stateLive: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  stateArchived: <rect x="3.5" y="3.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" />,
  stateGuest: <path d="M4 2.5h8L8 8l4 5.5H4L8 8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  stateReadonly: (
    <>
      <rect x="4" y="7.5" width="8" height="6" />
      <path d="M5.8 7.5V5.5a2.2 2.2 0 0 1 4.4 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, ...props }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      {PATHS[name]}
    </svg>
  );
}
