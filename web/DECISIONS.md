# Decisions log

Each entry: the question, the options, what was chosen and by whom.

## Stage 0 — setup

These three were put to the user as a question dialog, which was dismissed and followed by "continue". The recommended option was taken in each case. **None is confirmed by the user; all are reversible.**

| # | Question | Options | Taken | Status |
|---|---|---|---|---|
| 0.1 | Where does the new front end live? | `web/` standalone in this repo · `packages/web` workspace · separate repo | `web/` standalone | Default, unconfirmed |
| 0.2 | How to run the Stage 1 research? | Four parallel agents · sequential | Four parallel agents | Default, unconfirmed |
| 0.3 | What evidence may the research use? | Public sources only, no logins · links only · user-supplied access | Public sources only | Default, unconfirmed |
| 0.4 | Stage 2 reference products (the unfilled placeholder in the brief) | Supply before Stage 2 · none · name now | — | **Open** |

## Working mode (user, 2026-11-21)

- Build everything in one go. Ask for every permission up front, once.
- Where options compete, choose what is better and more effective, not what is quicker or reuses more. Rework earlier work when the better option needs it.
- Do not ask for the user's opinion again until everything is finished. Decisions below marked "Claude" were taken under this rule and are open to review at the end.
- No tests until everything is finished.

## Decisions taken under the working mode (Claude, 2026-11-21)

| # | Question | Options | Taken | Why |
|---|---|---|---|---|
| A.1 | Stage 2 references | Wait for the user to name products · proceed without | Proceed without; render three directions, choose one, keep the other two viewable | The placeholder was never filled and asking is now ruled out |
| A.2 | Who draws saved features? | Extend `packages/renderer` · a renderer inside `web/` | One renderer inside `web/`, shared by the editor and the embed screen | Keeps author and reader views identical within the build without touching the existing packages; the engine can still go behind `EditorController` later |
| A.3 | Draw order | Banded by kind · free across kinds | Free across kinds | A fixed order by kind is a limitation Felt and Datawrapper document against themselves |
| A.4 | Timeline model | Validity windows · keyframes | Validity windows (start and end per feature) with a lineage link between successive states of the same thing | Simple to author under deadline and fits immutable versions; the link leaves room for interpolation |
| A.5 | Reader-side screen | None · a mock embed route | Add `/embed/:id` as a fifth screen | Preview, embed options, legend, title block and playback all need it |
| A.6 | Undo | Terra Draw's · app-level | One app-level command stack covering geometry, style, order, groups and map settings | Terra Draw's covers geometry only and has open bugs |
| A.7 | Library pins | — | MapLibre 6.19.0 exact, TypeScript 6.0, command palette on Base UI instead of `cmdk`, `react-aria-components` Tree for the feature list | From the stack review |
| A.8 | `lightningcss` (MPL-2.0) | Accept · avoid Vite 8 and Tailwind 4 | Accept | Build-time only, never shipped; the licence rule covers what ships |
| A.9 | Build order | — | Samples and tokens → shell, sign-in, workspace → editor core → layers → presets, legend, export → time → versions and diff → vertex editing, import, phone | Groups the items whose designs depend on each other |

## Stage 3 — build decisions (Claude, under the working mode)

| # | Question | Options | Taken | Why |
|---|---|---|---|---|
| B.1 | Component base for shadcn | Base UI · Radix · React Aria | React Aria | One library covers the draggable tree, colour and date pickers, the command palette and RTL; shadcn's command palette on this base does not use `cmdk`. Replaces A.7's Base UI choice |
| B.2 | Node version | The machine default (20.18) · Node 24 | Node 24.22.2, per command through fnm | Vite 8 and react-router 8 refuse Node 20.18. The default Node was not changed; `.node-version` records it |
| B.3 | Interface language | English everywhere, mirrored in RTL · Arabic interface when the map is RTL | The editor and embed are Arabic when the map is RTL; sign-in, workspace and versions stay English and LTR | A mirrored editor with English labels is neither one thing nor the other |
| B.4 | Annotation text position | Screen-pixel offset (as in the existing API) · a geographic point | A geographic point | It holds at every zoom and can be dragged like any other vertex |
| B.6 | Drawing library (revisits 1.6) | Terra Draw · written directly on the map's pointer events | Written directly; Terra Draw removed | Holes in areas, locked features, hit-testing on the drawn curve and teeth, and a true-style preview while drawing all need the renderer's own shapes, which Terra Draw cannot see. The user had chosen Terra Draw on my recommendation; this reverses it under the working mode |
| B.7 | How saved features are drawn | MapLibre layers per kind · one 2D canvas over the map | One canvas, redrawn in the map's frame | Gives fully free draw order across kinds, text shaped by the browser (correct Arabic in the interface typefaces), and an export that uses the same code. Limits: features always sit above basemap labels; no label collision avoidance |
| B.8 | Palette follows | The interface theme · the basemap | The basemap | A dark basemap needs the dark colour set even in a light interface |
| B.5 | Where routing puts the reader view | Inside the editor only · its own route | `/embed/:tenant/:slug`, plus `/dev/engine` for the map engine on its own | See A.5 |

## Stage 2 — visual direction

Samples: `stage2/index.html` (three rendered directions with palettes, type and contrast ratios).

| # | Question | Options | Chosen |
|---|---|---|---|
| 2.1 | Which visual direction? | A · Copy desk (light, IBM Plex, ruled tables, word toolbar) · B · Control room (dark, Barlow, icon rail, tabbed side panel) · C · Atlas (light tinted, Newsreader + Libre Franklin, rounded panes, tool dock) | **Open between C and B.** First recommendation was A. The user (2026-11-21) liked C and asked for light and dark modes, and liked B if its tools moved to a bottom dock like C's. Both changes are in the samples; current recommendation is C |
| 2.1b | Final direction | C · Atlas · B · Control room | C · Atlas (user, 2026-11-21: "i like atlas") |
| 2.3 | One side panel or two? | One tabbed panel on one side · list on one side and inspector on the other | Two panes (user, 2026-11-21: "atlas c , two panels"). Inspector shown only on selection, both collapsible, docked flush instead of the sample's 10px gaps. No head-to-head study was found; the basis is pattern guidance, Figma's UI3 feedback and how Felt and Datawrapper are built |
| 2.4 | List row height | 35px as sampled · 32px | 32px (Claude): more features on screen without losing the direction |
| 2.5 | Numerals in Arabic | Western · Arabic-Indic | Western (Claude): matches Al Jazeera Arabic's practice |
| 2.6 | Map colours stored as | A hex value · a palette slot | A slot (Claude), so one map reads correctly on light and dark basemaps; custom colours remain possible |
| 2.2 | Light and dark? | Light only · light and dark | Light and dark (user, 2026-11-21, asked for it on C). Dark has its own neutrals, state colours and map palette |

## Stage 1 — enhancements

Asked 2026-11-21. IDs refer to `RESEARCH.md` section 3.

| # | Question | Options | Chosen |
|---|---|---|---|
| 1.1 | Which enhancements are in this build? | The recommended "Now" set as listed · the set with changes named by ID | The recommended "Now" set as listed (user, 2026-11-21: "i like all your recommendation") |
| 1.2 | How far does time go? | T1 only · T1 + T2 · T1 + T2 + T3 | T1 + T2 + T3, all in this build (user, 2026-11-21: "we want to build it"). The recommendation to defer T3 leaned on the current data shape; the user rejected that reasoning, since data is a reference and changes to it go in `CONTRACT-CHANGES.md` |
| 1.3 | Image export (I3) in this build? | Yes, PNG with presets · design the slot only | Yes, PNG with presets (user, 2026-11-21) |
| 1.4 | Version diff (U4)? | List plus side-by-side maps · list only · later | List plus side-by-side maps (user, 2026-11-21) |
| 1.5 | Phone and tablet scope? | Tablet full, phone review-and-publish · desktop and tablet only · full drawing on phone | Tablet full, phone review-and-publish (user, 2026-11-21) |
| 1.6 | Drawing library? | Terra Draw · hand-written on MapLibre events · mapbox-gl-draw | Terra Draw (user, 2026-11-21) |

## Integration — Phase 0 (user, 2026-11-21)

Making `web/` the product, wired to `packages/api`. Analysis and evidence are kept in the private planning notes. The user set the criteria: do it properly, keep the UI exactly as designed; effort, reuse and schedule are not reasons to choose.

| # | Question | Options | Chosen |
|---|---|---|---|
| P0.1 | Which renderer do the editor, the reader embed and image export share? | `web/src/render` canvas as it is · extend `packages/renderer` (MapLibre layers per kind) · MapLibre layers for shapes with browser text · our own WebGL layer inside MapLibre for shapes with browser text | **Our own WebGL custom layer inside MapLibre draws the shapes; the browser draws all text.** Measure the current canvas renderer first (on a real phone or the closest available) at 500, 2,000 and 5,000 features: first paint, panning, timeline playback, each result marked measured or estimated. Build the WebGL layer to match today's canvas output exactly, with the canvas as the reference. Replaces B.7 for shapes; text stays as B.7 built it |
| P0.2 | Where do feature fills and lines sit relative to the basemap's place and road names? | On top, as designed · below the names · a per-map setting | **Below the names.** Feature labels, icons and notes stay on top. The layer position lives in one place in the code, so it can be switched back or made a per-map setting later. This is a deliberate visual change from the approved design |
| P0.3 | What happens to `packages/app`, `packages/editor`, `packages/renderer` and `packages/viewer`? | Remove all four · remove app and editor only · keep all as reference | **Remove all four, tests included.** First copy into `web/`: the HTTP client, the Turnstile human-check widget, the iframe height protocol and the poller. Delete each package only after a search shows nothing imports it. Do not port the old tests. When everything is finished, propose a short list of essential tests and write only those; it should include the embed's safety checks (rejecting hostile resize messages) and the update polling |

## Integration — review round (user, 2026-11-21)

Four read-only reviews of the plan found blockers; the user accepted every recommendation.

| # | Question | Chosen |
|---|---|---|
| P0.2b | Free draw order across kinds cannot hold if fills sit under the basemap's names while text stays above them | **Keep the designed free order exactly.** The WebGL layer draws everything in one ordered pass: shapes, plus labels, notes and markers as images the browser rasterises (shaping and typefaces unchanged). The whole layer sits above the basemap's names, as designed. **Reverses P0.2.** The layer's position stays one constant in one module |
| R.1 | Pitched views | Keep pitch as designed; a pitched view rebuilds its view-dependent geometry (heads, teeth, taper, dashes) on the CPU each frame |
| R.2 | What "matches today's canvas" means | Per-pixel colour difference ≤ 8/255 inside shapes, edges displaced ≤ 1 px; each reference scene judged with its diff image |
| R.3 | Group `collapsed` | Per-person state kept in the browser, not in the shared document. Group `hidden` and `locked` stay shared |
| R.4 | Concurrent settings changes and "keep mine" | Settings travel as a patch of changed sections and items (per group, preset, legend item); `force` overwrites only those; the server re-checks every feature's group and preset reference after each save |
| R.5 | Archive rights and archived maps | Follow the UI: owners and admins archive (`map:archive`); archived maps do not count toward `maxMaps`; an archived map stays readable and refuses edits with a reason. Server grid and policies change to match |
| R.6 | `meta` on features (CC 18) | Dropped |
| R.7 | Uncommitted earlier work | Committed first, by area, before integration work; `web/screenshots` (regenerable) is not committed |

## Integration — taken while building (Claude, 2026-11-22, under "implement all phases, don't stop")

| # | Question | Taken | Why |
|---|---|---|---|
| I.1 | When to remove the four old packages | First, right after copying out the iframe protocol, the poller's backoff and the Turnstile loader | Changing `core` to the new model would otherwise have meant keeping four dead packages compiling against it. Removed only after a repository search showed no importers outside them; `demo/` was rebuilt on web/ |
| I.2 | Where templates live | In `@livemap/core`, used by the server and by the mock | One copy; the mock offers exactly what the server does |
| I.3 | An artifact's features carry no `updatedAt`/`updatedBy`, but the drawing, legend and diff code take `MapFeature` | The front end's `MapVersion` holds whole features; the client converts at its boundary (`fromArtifact`) | Keeps the published artifact free of editor data without widening every drawing signature |
| I.4 | What the reader sends as `If-None-Match` | The pointer's HTTP `ETag`, not the etag in its body | An object store computes its own validator; the body's etag is the artifact's |
| I.5 | The harvested iframe height protocol against an embed that fills its frame | The frame reports only when its content overflows; the host only grows the frame and validates sender window, origin, shape and bound. The Embed tab's snippet is unchanged; `embed-host.js` is opt-in | Reporting the document's height would echo the frame's own height forever; the snippet is part of the approved design |
| I.6 | A pointer that is missing (no map, or never published) | The embed's "nothing is published here" statement | A static store answers 404 for both and cannot tell them apart |
| I.7 | The sign-in page's specimen pointed at a mock-only map | A server setting, `SPECIMEN_MAP`, reported in `/config`; none means no picture | A real deployment has no such map |
| I.8 | What an artifact keeps of groups and presets | Only groups that published features belong to, and presets a published feature uses or a visible legend entry names | An empty group or unused preset tells a reader nothing and would otherwise mint a version |
| I.9 | Where feature labels go in the WebGL layer's order | After all shapes, as today's canvas output draws them; notes keep their place in the order | R.2 makes today's output the reference |
| I.10 | A dependency for polygon triangulation | `earcut` (ISC), already installed through MapLibre | No stencil buffer (MapLibre issue #3536); holes need triangulating |
| I.11 | Guest workspace lifetime: 7 days (server) or 24 hours (mock) | The server's 7 days, unchanged; the mock still says 24 hours | **Open — the user's call** |
| I.12 | How the workspace packages are compiled | From source, through a `livemap-source` export condition (TypeScript, Vite and `node --conditions`) | The front end and the server never run a stale build of `core` |
| I.13 | The existing API tests, written against the old contract | Left as they are, not run, not edited | The user asked for no tests to be written, and a failing test may not be edited without the user's OK |

## Integration — follow-up (user, 2026-11-22)

| # | Question | Chosen |
|---|---|---|
| F.1 | Place search (P1 in RESEARCH.md, accepted in 1.1) needs a geocoder to be useful | **Removed entirely** for now: the editor's search box, the palette's "Go to a place" entries, adding a result as an icon, `searchPlaces`, `/api/v1/places` and the built-in gazetteer. Authors find a place by panning. A geocoder can bring it back later (research kept in the private planning notes) |

## Editor interactions (user, 2026-11-22)

From a study of map tools, design tools and WCAG 2.2 (private planning notes, `interactions-study.md`). The user's revised table is the specification; these are their answers to its open questions.

| # | Question | Chosen |
|---|---|---|
| X.A | Tool after finishing a shape | Every tool returns to Select; **Q** or a visible lock button keeps it active (double-clicking the tool as a secondary way). One rule, easy to find; matches tldraw and Excalidraw |
| X.B | Moving a feature | **Select first, then drag, for every kind.** An accidental move on a live news map is a factual error. A "Move, then tap the destination" command is the no-drag alternative |
| X.C | Rotate and tilt | **Off in the editor and the embed, in every gesture** (drag, keyboard, twist, tilt). Bearing and pitch are set in Map settings |
| X.D | Freehand, drag handles for rotate/resize | Later. **Typed rotation and size fields now** |
| X.E | Panning without dragging | **A compact pan pad next to the zoom buttons, in the editor and the embed; authors can hide it in the embed.** Meets WCAG 2.2 SC 2.5.7 (keyboard panning alone does not) |

The rest of the revised table stands as written: touch double-tap never finishes a shape; arrows by press-drag or clicks with a one-time hint; an on-map bend handle with presets; Space or middle-button drag pans where a drag draws; one-click text with an offset that flips for right-to-left and near edges; arrow keys move a selection (1 px, Shift 10) and otherwise pan; a right-click menu on the map; keyboard drawing with a centre crosshair and labelled buttons; undo and redo of points while drawing; automatic pen mode with a toggle; no drawing dock on phones; fullscreen and reset-view buttons in the embed.
