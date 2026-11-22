# How the front end is wired to the server

`web/` is the product's front end. A production build talks to the API in
`packages/api` and reads published maps straight from the artifact store; a
development build can run the same screens over an in-memory mock. This file
says how the two sides meet, what the mock still does, and what is not done.
The server side is described in the repo's `docs/architecture.md`; the
contract, entry by entry, in `CONTRACT-CHANGES.md` (its last section is the
contract as implemented).

## The two seams

| Seam | Contract | Implementations |
|---|---|---|
| Data | `ApiClient` in `src/api/client.ts` | `createHttpApiClient` (`src/api/http.ts`), and `createMockApiClient` (`src/api/mock/`) for development |
| Map | `EditorController` in `src/editor/controller.ts` | `createMapLibreController` (`src/editor/engine/`), drawing through the shared renderer in `src/render/` |

Screens reach data only through the hooks in `src/api/hooks.ts` (TanStack
Query) and the editor's store, which take the client from `useApi()`. The model
is `@livemap/core`, shared with the server.

## Which client runs

`src/main.tsx` decides once, at start-up:

| Build | Client |
|---|---|
| Production (`npm run build`) | Always the HTTP client, at the page's own origin unless `VITE_API_BASE` is set. The mock, its seed maps and the `/dev` pages are not in the build. |
| `npm run dev` | The mock, with personas, URL switches and the `/dev/states` gallery (switches documented at the top of `src/api/mock/control.ts`). |
| `VITE_API=http npm run dev` | The HTTP client, through Vite's proxy to `LIVEMAP_API` (default `http://127.0.0.1:8787`), so development is same-origin like production. |

## The HTTP client

`createHttpApiClient(baseUrl)`:

- **Every failure is an `ApiError`.** A non-2xx answer takes `code` from the
  body's `error`, `reason`, `current` and `retryAfter` (from `Retry-After`, or
  the body). A rejected `fetch` is `network` with status 0. An unknown code, or a
  body that is not JSON, is `internal_error` (a 404 without a body is
  `not_found`).
- **No retries of its own.** The query client retries `network` failures, twice;
  a save is never repeated behind the user's back.
- **Sends exactly what it is given.** The server's validator refuses rather than
  repairs.
- **Token storage.** A guest's token lives in `localStorage` (a guest cannot
  sign in again once it is lost); a pasted member token in `sessionStorage`.
  Storage that throws (a sandboxed frame, a privacy mode) leaves the token in
  memory for the visit. Signing out forgets it.
- **Published maps are not read through the API.** `getPublishedPointer`,
  `getPublishedVersion` and `getPublished` fetch from `artifactBase` (from
  `/config`), with no credentials. The pointer poll sends `cache-control:
  no-cache` and `If-None-Match` with the pointer's HTTP `ETag`; a 304 is
  `{ notModified: true }`. `getVersion` fetches the URL the version list gave.
  Artifacts come back through `fromArtifact` (`src/model/published.ts`), which
  restores whole features for the drawing and diff code.

## Saving

The editor's store calls `editMap` and `publishMap` itself, because a save, a
forced save after a 409 and "save, then publish" are steps of one undoable
document. A save sends the features changed since the last save, the ids
deleted, and the settings as a patch (`settingsPatch` from core: changed
sections whole, presets and groups by item). "Keep mine" after a 409 sends the
same request with `force`, which overwrites only what it names; "Reload theirs"
fetches the map again. Three behaviours to keep:

- **The store loads the document once.** `LoadedEditor` in
  `src/screens/editor/index.tsx` creates the store from the first answer and
  afterwards takes only `publishedVersion` and `publishedRev` from refetches.
- **Write-through.** `useWriteThrough` copies every saved baseline and publish
  into the query cache.
- **Folding a group is not a save.** It is kept per person and per map in
  `localStorage`.

## Sign-in

- **Members** paste a session token (from `npm run dev-workspace` locally, or
  `npm run mint-token`). There is no identity provider yet.
- **Guests** go through Cloudflare Turnstile when the server has a site key
  (`humanCheckSiteKey` in `/config`); `src/screens/signin/human-check.tsx`
  loads the widget only then, and keeps a stand-in for the mock's `mock-` keys.
  The guest terms on the page come from `/config`.
- **The specimen** under the forms is the published map the server names in
  `SPECIMEN_MAP`; without one the page shows none.

## The embed

- `/embed/:tenant/:slug` follows the map with `useLiveMap`
  (`src/screens/embed/use-live-map.ts`): the pointer every 10 seconds, not while
  the tab is hidden, at once when it becomes visible again, and with exponential
  backoff (up to 15 minutes) while the artifact host is failing. Each version's
  artifact is fetched once.
- It runs inside a publisher's iframe sandboxed without `allow-same-origin`,
  so at an opaque origin; the server sends what that needs (`docs/architecture.md` §9).
- **Auto-height.** With `embedId` in its URL, the embed tells the host page when
  its content does not fit (`src/embed/protocol.ts`), and `/embed-host.js`
  (built from `src/embed/host.ts`, loaded once with `<script type="module">`)
  grows the frame. The host accepts only messages from that iframe's window and
  origin, with exactly the protocol's shape and a bounded height, and only grows.
  The snippet on the Embed tab does not include it; it sizes the frame itself.

## What the mock still does

`src/api/mock/` implements the whole `ApiClient` in memory for development and
for the state gallery: personas and roles, quotas, revisions, guest signup, the
human check, publishing with the same builder and hash as the server
(`buildArtifact`, `publishHash` from core), the same artifact key layout, the same templates, and URL switches to force
any error. Its seed maps are development data only.

## Not done

- **No Content-Security-Policy beyond framing.** A full policy needs
  `connect-src` for the API, the artifact base, the tile host and Turnstile;
  `worker-src data: blob:` (MapLibre starts its worker from a `data:` URL inside
  the sandboxed embed); `img-src data: blob:` for exported images.
- **The artifact bucket's CORS rule** is written down in
  `docs/architecture.md` §9 and has to be applied to the bucket.
- **Basemap tiles** come from OpenFreeMap's free service with no agreement;
  attribution is shown on screen and on exported images.
- **Browsers cap live WebGL contexts** (16 in desktop Chrome, 8 on Android).
  The app keeps at most two maps alive; a page that embeds many maps should
  lazy-load the iframes (`loading="lazy"`, which the snippet sets).

## The map seam

The editor never touches MapLibre. Everything it asks of the map goes through
`EditorController`, created by the factory in
`src/screens/editor/use-controller.ts`. The controller never owns the document;
the store above it owns undo, saving and selection, and expects
`gesture: "update"` while dragging and one `"commit"` at the end. `/dev/engine`
exercises a controller on its own.

### Controller calls that exist for the editor's layout

These are not API changes and never reach a server. Any engine behind the seam has to honour them.

- **`setInsets({ top, bottom, start, end })`.** How much of the map the panes, the tool dock and the timeline cover, in CSS pixels, with `start` and `end` following the editor's direction. `fitFeatures` and `fitBounds` frame their target inside what is left, so nothing lands under a pane. It must not move the camera by itself.
- **`setRendering(enabled)`.** `false` while the full-screen preview covers the editor: the editor's map stays mounted (so the camera is exactly where it was on return) but draws nothing, leaving the preview's map the only one animating. The MapLibre implementation stops the camera, pauses its overlays and holds the map container at its current pixel size, because MapLibre redraws whenever its container is resized. `true` releases the size, resizes and paints once. Calls made while paused are kept.
- **`setLabelObstacles(boxes)`.** The on-screen rectangles of the furniture laid over the map (title block, key, credits, folded tabs), in CSS pixels from the map's top-left corner. Feature labels must move to another free place, or be left out, rather than sit under them. The editor measures them with `watchObstacles` (`src/render/obstacles.ts`) from every element marked `data-label-obstacle`; the embed does the same for its key, zoom buttons and scale bar.
