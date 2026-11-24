# livemap web

The front end for livemap: sign in, a workspace of maps, an editor for drawing live-event maps (areas, lines, movement arrows, front lines, icons and notes, in English or Arabic), version history with a visual diff and rollback, and the embeddable reader view that goes into an article.

A production build talks to the livemap API (`packages/api`) through `src/api/http.ts` and reads published maps straight from where the server says they are served. `npm run dev` runs the same screens over an in-memory mock (`src/api/mock/`) behind the same `ApiClient` interface, with seed maps, personas and the `/dev` pages. The map is drawn by one WebGL layer inside MapLibre (`src/render/`), shared by the editor, the embed and image export. `INTEGRATION.md` says how it is wired to the server.

## Requirements

- Node 24 (`.node-version` at the repo root). This is an npm workspace: run `npm install` at the repo root.
- A browser with WebGL.

## Run it

```bash
npm install                        # at the repo root
npm run dev -w @livemap/web        # http://localhost:5180, over the mock
```

Against a running server (`npm run serve` or `npm run demo` at the repo root), through Vite's proxy:

```bash
VITE_API=http LIVEMAP_API=http://127.0.0.1:8800 npm run dev -w @livemap/web
```

In production the server serves `dist/` itself; see the repo's `docs/architecture.md` §9.

Other scripts:

```bash
npm run typecheck    # tsc --noEmit
npm run build        # typecheck, then a production build in dist/
npm run preview      # serve dist/ on http://localhost:5181
npm run screenshots  # the screenshot matrix (see below)
```

A production build always uses the real API and leaves out the mock and the `/dev` pages.

## Routes

| Path | Screen |
|---|---|
| `/` | Sign in: a guest workspace, or a session token |
| `/maps` | The workspace: maps, archived maps, new map from a template |
| `/maps/:id` | The editor. Seed maps: `m_shaheen` (Arabic), `m_wildfire`, `m_earthquake`, `m_derna`, `m_haouz`, `m_suez`, `m_nile`, `m_election`, `m_alamein`, `m_aftershocks` (4,700 features) |
| `/maps/:id/versions` | Versions: `?tab=history`, `?tab=compare&a=<n>&b=<n or draft>`, `?tab=embed`, `?view=<n>` |
| `/embed/:tenant/:slug` | What a reader sees, e.g. `/embed/al-mashriq/cyclone-shaheen` |
| `/dev/states` | The state gallery: every screen in every state |
| `/dev/kit` | Every UI component in every state |
| `/dev/engine` | The map engine on its own |
| `/dev/extras` | The editor's secondary panels on their own |

## Signing in to the mock

Paste one of these tokens on the sign-in page (a development build lists them under the form):

| Token | Who | Can |
|---|---|---|
| `mock-owner` | Layla Haddad | everything |
| `mock-admin` | Sarah Whitfield | everything |
| `mock-editor` | عمر الفارسي | create, edit, publish; not archive |
| `mock-contributor` | يوسف بن عمر | create, and edit only the maps he made |
| `mock-viewer` | Hannah Lindqvist | read only |

Or skip the form with a URL switch. They combine, and are read once when the page loads:

| Switch | Effect |
|---|---|
| `?persona=owner` (also `admin`, `editor`, `contributor`, `viewer`, `guest`, `guest-full`, `guest-expired`, `guest-disabled`, `guest-capacity`, `rate-limited`, `signed-out`) | Start as that person or in that situation |
| `?fast=1` | No simulated latency |
| `?latency=3000` | A fixed latency in milliseconds |
| `?mock=editMap:stale_revision:once` | Force a failure: any method (or `*`) and any error code; `:once` for the next call only |
| `?humancheck=1` | Guest signup asks for the human check |
| `?mock-reset=1` | Forget this tab's changes and start from the seed |

For example `/maps/m_shaheen?persona=owner&fast=1`. The full list is at the top of `src/api/mock/control.ts`. Changes are kept in `sessionStorage`, so they last until the tab is closed.

## Screenshots and the state gallery

- `/dev/states` lists every screen and state from `src/screens/dev/catalogue.ts`; each opens by link and is driven into its state in place.
- `npm run screenshots` captures that catalogue at several widths, directions and themes into `screenshots/`, with an index. It starts its own dev server and uses the Chromium already cached by Playwright; it never downloads a browser. Options are documented at the top of `scripts/screenshots.mjs`.
- `node scripts/shot.mjs <url> <out.png> [width] [height] [--dark] [--full]` takes a single screenshot.

## Working on the map

The full key list is the editor's shortcut sheet (`?`), generated from `src/editor/store/shortcuts.ts`. What is not a key:

- A drawing tool stays active after each shape, so several arrows go in a row. **Q** or the dock's Keep button turns that off (back to Select after each shape); the choice is remembered in the browser.
- Arrows draw by dragging, or point by point with clicks. Space+drag and middle-button drag always move the map.
- Undo while drawing takes back a point; straight after Finish it reopens the shape.
- Keyboard drawing: with a drawing tool, an arrow key shows a cross at the middle of the visible map. Arrow keys move the map under it, Enter adds a point, Enter on the same spot again finishes. The draw strip has the same actions as buttons.
- Moving without a drag: **M** (or Move in the inspector or a menu), then click or tap the destination. Arrow keys nudge a selection (Shift: 10 px).
- Right-click on the map: the list's commands for what is under the pointer; on empty map, add here and paste here.
- A selected arrow has a diamond at its middle: drag it, or tap it and then tap the target. Double-click straightens.
- A selected note has a handle on its anchor and one on its text box. Shift keeps the leader at 45° steps.
- A stylus turns pen mode on: the pen draws, a finger moves the map. The status bar switches it off.
- The map stays north-up. Bearing and pitch are set in Map settings.

## Where things are

| Path | What |
|---|---|
| `src/model/types.ts` | The domain model |
| `src/api/` | `ApiClient`, the query hooks, and the mock |
| `src/editor/controller.ts` | `EditorController`, the map seam |
| `src/editor/store/` | The editor's document store, undo and saving |
| `src/editor/engine/`, `src/render/` | The MapLibre controller and the renderer shared by the editor, the reader and image export |
| `src/screens/` | One folder per screen |
| `src/i18n/` | Strings, English and Arabic |
| `src/styles/tokens.css` | Colours, type, sizes |

## Documents

- `DESIGN.md`: the visual direction and how the interface uses it.
- `DECISIONS.md`: what was chosen, from which options, and by whom.
- `RESEARCH.md`: the research and the accepted feature set.
- `CONTRACT-CHANGES.md`: every way the model and API depart from the existing API.
- `INTEGRATION.md`: what is mocked, what replaces it, what production needs, and how to put the existing engine behind the editor.
