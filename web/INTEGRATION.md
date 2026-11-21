# Going live

This front end runs entirely against in-memory stand-ins. This file says what each stand-in is, what replaces it, what production needs that development does not, and how to put the existing livemap engine behind the editor's map seam.

The shapes the real API must speak are in `src/model/types.ts` and `src/api/client.ts`. Every way they differ from the existing API is in `CONTRACT-CHANGES.md`; "CC 31" below means its entry 31.

## The two seams

Everything hangs off two interfaces.

| Seam | Contract | Today | Replaced by |
|---|---|---|---|
| Data | `ApiClient` in `src/api/client.ts` | `createMockApiClient()` from `src/api/mock/`, created in `src/main.tsx` | An HTTP client implementing `ApiClient` |
| Map | `EditorController` in `src/editor/controller.ts` | `createMapLibreController` in `src/editor/engine/` | This engine, or the existing livemap engine behind the same interface (see the last section) |

Screens reach data only through the hooks in `src/api/hooks.ts` (TanStack Query) and the editor's store, which take the client from `useApi()`. Nothing outside `src/api/mock/`, `src/main.tsx` and the state gallery imports the mock, and nothing calls `fetch` for data. The editor talks to the map only through `EditorController`.

## What is mocked

| # | Stand-in | Where | Replaced by |
|---|---|---|---|
| 1 | The API client | `src/api/mock/index.ts`, loaded by `src/main.tsx` | An HTTP client |
| 2 | Server rules: sessions, roles, quotas, revisions | `src/api/mock/server.ts`, `server-rules.ts` | The real server |
| 3 | The publish pipeline and artifact store | `src/api/mock/publish.ts`, `world.ts`, `mintVersion` in `server-rules.ts` | The server's pipeline and the object store |
| 4 | Reading artifacts | `getVersion`, `getPublished`, `getPublishedPointer`, `getPublishedVersion` in `server.ts` | Fetches from the CDN |
| 5 | Sign-in tokens and the human check | `MOCK_TOKENS` in `server-rules.ts`, `src/screens/signin/human-check.tsx` | Real tokens; a real verification widget |
| 6 | Place search | `src/api/mock/gazetteer.ts` (269 places) | A geocoder behind the API |
| 7 | Templates | `src/api/mock/templates.ts` | Templates held by the server |
| 8 | Seed data | `src/api/mock/seed/` | Nothing in production; fixtures for a staging server |
| 9 | Persistence | `sessionStorage`, in `world.ts` | The database |
| 10 | Dev switches and personas | `src/api/mock/control.ts`, `personas.ts`, URL parameters | Removed from production builds |
| 11 | Latency | `nextLatency` in `control.ts` | The network |

### 1. The API client

**Now.** `createMockApiClient()` returns an object whose twenty methods wait 150–400 ms, apply any failure forced through `mockControl`, call the in-memory server, and return a deep copy. `src/main.tsx` loads the mock with a dynamic `import()`, so the mock, its seed maps and the gazetteer are a chunk of their own (107 kB) and not part of the main bundle.

**Real.** A new `src/api/http.ts` exporting `createHttpApiClient(baseUrl): ApiClient`. Suggested mapping, following the existing URL layout (`/api/v1`, with `/auth/guest` and `/config` public):

| Method | Request |
|---|---|
| `getConfig` | `GET /config` |
| `signInAsGuest` | `POST /auth/guest` with `{ humanCheckToken }` |
| `signInWithToken` | Store the token, then `GET /api/v1/session` |
| `signOut` | Forget the token; no request is needed for a bearer token |
| `getSession` | `GET /api/v1/session` |
| `listTemplates` | `GET /api/v1/templates` |
| `listMaps` | `GET /api/v1/maps?archived=true\|false` |
| `createMap` | `POST /api/v1/maps` |
| `getMap` | `GET /api/v1/maps/:id` |
| `archiveMap`, `unarchiveMap` | `POST /api/v1/maps/:id/archive`, `…/unarchive` |
| `editMap` | `POST /api/v1/maps/:id/edit` |
| `publishMap` | `POST /api/v1/maps/:id/publish` |
| `listVersions` | `GET /api/v1/maps/:id/versions` |
| `getVersion` | `GET` the version's `url` (section 4) |
| `rollbackMap` | `POST /api/v1/maps/:id/rollback` with `{ toVersion }` |
| `getPublished` | `GET {artifactBase}/t/:tenant/:slug/latest.json`, then the artifact it names |
| `getPublishedPointer` | `GET {artifactBase}/t/:tenant/:slug/latest.json` with `If-None-Match`; 304 is `{ notModified: true }` (CC 48) |
| `getPublishedVersion` | `GET {artifactBase}/t/:tenant/:slug/v{n}.json` (CC 48) |
| `searchPlaces` | `GET /api/v1/places?q=&lang=` |

The paths that do not exist yet are suggestions; the method signatures are the contract.

The client must:

- **Turn every failure into an `ApiError`.** The hooks and every screen switch on `error.code` and are typed to receive nothing else.
  - A non-2xx answer: `code` from the body's `error`, `reason` from `reason`, `current` from `current`, `status` from the response.
  - `Retry-After`: parse the header into `retryAfter` (seconds) for 429 and 503.
  - `fetch` rejecting (offline, DNS, CORS): `code: "network"`, `status: 0`.
  - A 5xx with no recognised `error`, or a body that is not JSON: `code: "internal_error"`.
  - An `error` value the front end does not know: `internal_error`, keeping the server's `reason`.
- **Send the bearer token** on every `/api/v1` request, and decide where it lives. The mock keeps the session in `sessionStorage` with the rest of its state; a real token needs a deliberate choice (memory plus `sessionStorage` is the least surprising for a tool people leave open all day).
- **Not retry.** `makeQueryClient` in `src/app/providers.tsx` retries only `network` errors, twice. A client that retries on its own would repeat non-idempotent saves.
- **Send exactly what it is given.** No defaults filled in, no fields dropped: the server's validator does not repair requests.

### 2. Server rules

**Now.** `src/api/mock/server.ts` (the twenty methods) and `server-rules.ts` (the rules they share) enforce everything below. Each is something the interface depends on and shows to the user, so the real server has to behave the same way or the difference has to be found and decided.

Sessions and roles

- Everything needs a session except `getConfig`, `signInAsGuest`, `signInWithToken`, `getPublished`, `getPublishedPointer` and `getPublishedVersion`. No session: 401 `unauthorised`.
- Capabilities by role, in `ROLE_CAPABILITIES`:

  | Role | read | create | edit | publish | archive |
  |---|---|---|---|---|---|
  | owner, admin | yes | yes | yes | yes | yes |
  | editor | yes | yes | yes | yes | no |
  | contributor | yes | yes | own maps only | no | no |
  | viewer | yes | no | no | no | no |

  **This grid is the mock's assumption.** The real one lives on the server; compare them first, because the interface hides and disables controls from `session.capabilities`.
- A contributor's edit of a map someone else created: 403 `forbidden` with a reason. The interface avoids offering it: `createdBy` (CC 47) tells it which maps are the contributor's own, and the others open read-only.
- A guest is the owner of a temporary workspace. Its session carries `expiresAt` (24 hours in the mock); after that every call answers 401 with a reason saying the workspace expired.
- Guest signup: 403 `guest_signup_disabled` when switched off, 503 `guest_capacity` with `Retry-After` when full, 403 `human_check_failed` when the verification token is missing or refused.

Limits

- `quota_exceeded` (403) for: creating a map at `maxMaps`; restoring an archived map at `maxMaps`; a save that would leave more than `maxFeaturesPerMap` features; a publish or rollback at `maxVersionsPerMap`.
- Mock values: members 200 maps, 5,000 features, unlimited versions; guests 5 maps, 2,000 features, 25 versions. The guest figures were given; the member figures are placeholders. `AppConfig.guest` (CC 46) carries the guest figures to the sign-in page.
- **Assumption:** archived maps do not count toward `maxMaps`, because there is no delete and a full workspace would otherwise have no way out. `session.usage.maps` counts the same way.
- A save over 1 MB: 413 `body_too_large`. The size is a placeholder for the server's real body limit.

Saving

- `edit.rev` must equal the map's current `rev`, unless `force` is set; otherwise 409 `stale_revision` with `current` (CC 33, 34).
- An accepted edit applies `delete`, then `put` (whole features, upserted by id), then `settings`, `title` and `uiDir` when present, and increases `rev` by exactly one (CC 31).
- The server stamps `updatedAt` and `updatedBy` on every feature it accepts and on the map (CC 8, 28).
- A refused edit changes nothing.
- An archived map cannot be edited, published or rolled back: 403 with a reason.

What the mock does not check, and a real server should: that rings are closed and coordinates are in range; that `groupId` and `presetId` refer to things in `settings`; that ids are unique per map; the length of text fields. There is no error code for a rejected body yet ("Gaps" in `CONTRACT-CHANGES.md`).

### 3. The publish pipeline

**Now.** `src/api/mock/publish.ts` builds the artifact; `mintVersion` in `server-rules.ts` records it; `world.ts` keeps artifacts in memory.

**Real.** The server's pipeline, writing to the object store. It must:

- Build the artifact as `MapVersion` (CC 36): leave out hidden features and features in hidden groups; reset or omit `hidden`, `locked` and `collapsed`; drop legend items that refer to a feature left out; sort features by `order`; include `settings` whole, which carries `timeline.windowMs` (CC 24) and the arrows' `bend` (CC 16) along with everything else.
- Decide `unchanged` from a hash of a canonical form of `title`, `uiDir`, `settings` and the published features, excluding the fields listed in CC 35. On `unchanged`, mint nothing, answer with the live version's number and etag, and move `publishedRev` up to the current `rev` (CC 27).
- Otherwise write an immutable object at `t/{tenant}/{slug}/v{n}.json` with `Cache-Control: public, max-age=31536000, immutable`, then repoint `t/{tenant}/{slug}/latest.json` with `Cache-Control: public, max-age=5, stale-while-revalidate=30`.
- Record `etag`, `byteSize`, `featureCount`, `publishedAt`, `publishedBy { userId, name }`, `url`, `cacheControl` and `origin` (CC 37 to 39).
- Roll back by writing the old artifact's content as a new version with `origin: { type: "rollback", fromVersion }`, leaving the draft alone, and setting `publishedRev` to the revision the restored version was built from.

The mock's `etag` and hash come from a 53-bit string hash chosen for being synchronous. They are not what an object store reports; nothing in the interface depends on their form.

The storage key layout above is the mock's guess at the real one. The front end never builds a key: it reads `VersionRecord.url` and `VersionPointer.url`.

### 4. Reading artifacts

**Now.** The four read calls answer from the in-memory artifact store. `getVersion` requires a session; the three `getPublished*` calls do not.

**Real.** Plain fetches from the CDN, not API calls, because the read path never touches the database.

- `getVersion(id, version)`: fetch `VersionRecord.url`. Immutable, so the hook caches it for good (`staleTime: Infinity`).
- The embed (`/embed/:tenant/:slug`) follows the map with `useLiveMap` in `src/screens/embed/use-live-map.ts`: it polls `getPublishedPointer` every 10 seconds with the last ETag (TanStack Query's `refetchIntervalInBackground: false`, so a hidden tab does not poll), and calls `getPublishedVersion` once for each version the pointer names. A 304 costs no artifact (CC 48).
- `getPublished(tenant, slug)` is the one-shot form, used by the published-map specimen on the sign-in page.
- `getPublished` returns `null` for a map that exists and was never published, and throws `not_found` for an address with no map. A static store answers 404 for both; decide which the embed should show.

The object store has not been run against a real bucket yet; this step depends on that.

### 5. Sign-in

**Now.**

- `signInWithToken` accepts five fixed strings (`MOCK_TOKENS`): `mock-owner`, `mock-admin`, `mock-editor`, `mock-contributor`, `mock-viewer`. Anything else is a 401. A development build lists them under the token form.
- `signInAsGuest` creates a tenant and a session in memory.
- `config.humanCheckSiteKey` is `null` unless `?humancheck=1` (or `mockControl.requireHumanCheck(true)`), in which case it is the placeholder `"mock-site-key"`, the sign-in page shows the stand-in widget in `human-check.tsx`, and any token except `"fail"` passes.

**Real.** Tokens are HMAC-signed bearer tokens from guest signup or the minting script; there is no identity provider yet, so pasting a token stays the member sign-in until one exists. The sign-in screen must render the real verification widget when `humanCheckSiteKey` is set and pass its token to `signInAsGuest`. Rejected credentials are throttled separately from valid traffic on the server, so sign-in can answer 429 with `Retry-After` on its own.

### 6. Place search

**Now.** `src/api/mock/gazetteer.ts`: 269 places with Arabic and English names, matched by a folded form (case, Latin accents, Arabic vowel marks, hamza forms of alif, ta marbuta, alif maqsura, the article "ال") and a list of other spellings. Results are ranked exact, prefix, word prefix, contains; a country match ranks after every name match. At most eight results. `bounds` is a fixed box around the point. Every town the seed maps centre on is in it.

**Real.** An endpoint on the API in front of a geocoder, so the key and the cost stay on the server. It must return names in the requested language with real `bounds`, and match Arabic input as forgivingly as the mock does, or the search will feel worse than the demo. Choosing the geocoder is open: check its licence (the no-AGPL rule), its attribution requirement, and its Arabic coverage before committing. Coordinates and Google Maps links typed into the search box are parsed in the browser and never reach this endpoint.

### 7. Templates

**Now.** `src/api/mock/templates.ts` holds four templates. Each sets presets, groups, legend, title-block note, timeline (including `windowMs`) and opening view, and no features. Names are Arabic for a right-to-left map and English otherwise.

**Real.** The server owns templates and `createMap` applies one. Move the definitions there, or keep them here and have `createMap` followed by a first edit that writes the settings; the first is one request and cannot half-fail.

### 8. Seed data

**Now.** `src/api/mock/seed/`, one module per map: twelve maps in a member workspace "Al Mashriq Newsroom" with seven named people, version histories, and one map of 4,700 generated points for load. Timestamps are relative to when the tab first loaded.

**Real.** None of it ships. It is worth keeping as fixtures for a staging server: `buildSeedMaps(now)` returns plain data that a script could post through the real API. The 4,700-point map says in its own title block that it is simulated; every other map is real geography at newsroom precision, with outlines stated as simplified where they are.

### 9. Persistence

**Now.** `world.ts` writes to `sessionStorage` under keys beginning `livemap.mock.v2`: an index (tenants, map documents, version records, session, switches), the feature list of each map edited in this tab, and each artifact published in this tab. Everything else is rebuilt from the seed on load. Every access is guarded; when storage is blocked or full the tab works from memory. A change to the seed or the model can leave a tab with an index from an older shape: open any page with `?mock-reset=1`.

**Real.** The database. Nothing to port.

### 10. Dev switches

**Now.** `mockControl` (exported from `@/api/mock`) and the URL parameters `?mock=`, `?persona=`, `?latency=`, `?fast=1`, `?humancheck=`, `?mock-reset=1`, all documented at the top of `src/api/mock/control.ts`. Personas live in `personas.ts`. `createMockApiClient` reads the URL once.

**Real.** They must not exist in a production build. The state gallery (`/dev/states`) and the screenshot script depend on them, so the simplest arrangement is to keep the mock for development and choose the client at build time in `src/main.tsx`:

```ts
const api = import.meta.env.VITE_API_BASE
  ? createHttpApiClient(import.meta.env.VITE_API_BASE)
  : (await import("@/api/mock")).createMockApiClient();
```

The mock is already a separate chunk, so a build with `VITE_API_BASE` set leaves it out. Drop the `/dev/*` routes from that build in the same change.

### 11. Latency

**Now.** 150–400 ms per call, 0 with `?fast=1`.

**Real.** Whatever the network gives. Before removing the mock, run the editor once with `?latency=3000` and once with `?mock=*:network`: every screen should show a waiting state and an error state in place.

## How the editor keeps the cache honest

The editor does not save through a mutation hook. Its store (`src/editor/store/store.ts`) calls `ApiClient.editMap` and `publishMap` itself, because a save, a forced save after a 409 and "save, then publish" are steps of one undoable document, not independent requests. Three behaviours to keep when the client changes:

- **The store loads the document once.** `LoadedEditor` in `src/screens/editor/index.tsx` creates the store from the first answer and afterwards takes only `publishedVersion` and `publishedRev` from refetches, so a refetch never replaces work in progress.
- **Write-through.** `useWriteThrough` in the same file copies every saved baseline and publish into the query cache and invalidates the map list, and the versions and published queries when the live version moved. Leaving the editor and coming back never rebuilds the document from an older answer.
- **A 409 leaves everything as it was.** `error.current` says who saved and when. "Reload theirs" fetches the map again through the client; "keep mine" saves again with `force: true`, after which the server's copy (which also holds what the other person saved) is fetched.

The server stamps `updatedBy` on saved features; the write-through keeps the client's value until the next fetch. "Last changed by" in the inspector is the one field that can be briefly out of date.

The versions screen rolls back through `useRollbackMap` in `src/api/hooks.ts`, which refetches the draft, the versions and the published queries afterwards.

## What production needs that development does not

Found while building and checking the production build; none of it is visible in `npm run dev`.

**Serving the app**

- **Every route serves `index.html`.** The router owns `/`, `/maps`, `/maps/:id`, `/maps/:id/versions`, `/embed/:tenant/:slug` and `/dev/*`; a reload or a shared link on any of them must get the HTML, not a 404. `vite preview` does this; a static bucket or a reverse proxy needs a fallback rule.
- **Hashed assets are immutable; `index.html` is not.** Everything under `/assets/` carries a content hash and can be served `Cache-Control: public, max-age=31536000, immutable`. `index.html` must revalidate (`no-cache`), or a deploy is invisible until caches expire.
- **The MapLibre worker is a separate file.** `src/render/maplibre.ts` imports `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` and hands the URL to `setWorkerUrl` before any map exists. The build emits it as `assets/maplibre-gl-worker-<hash>.js` (550 kB). It must be served from the same place as the bundle with a JavaScript MIME type. Missing, the map draws nothing and the only sign is a 404. (`?url` instead of `?worker&url` breaks it in both dev and build; the comment in `maplibre.ts` says how.)
- **MapLibre loads only where a map is drawn.** It is one named chunk (`assets/maplibre-<hash>.js`, 1.05 MB, 291 kB gzipped), loaded by the editor, versions, embed and the sign-in specimen (lazily, after the forms). The workspace never loads it. This is the only chunk over 500 kB, and it is the library itself.

**The embed**

- **A sandboxed iframe has an opaque origin.** The embed snippet uses `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` without `allow-same-origin`, so every request the embed makes is cross-origin, including to its own server: the module scripts, the stylesheet, the fonts, the worker, `/config` and every artifact. All of them must be sent with `Access-Control-Allow-Origin: *`. `vite preview` sends no CORS headers, so the embed works in preview on its own page but not inside the sandboxed iframe; it was checked inside an iframe against a static server that sends the header.
- **The artifact bucket needs a CORS rule** for the reader's poll: allow `GET`, `HEAD` and `OPTIONS` from any origin; allow the request headers `if-none-match` and `cache-control` (a conditional request is not a simple request, so the browser preflights it); expose `ETag`, or the client cannot read the ETag it has to send next time.
- **No storage in the embed.** It reads none, so it works where third-party storage is blocked.

**Third parties**

- **Basemap tiles** come from OpenFreeMap (`https://tiles.openfreemap.org/styles/{positron,bright,liberty,dark,fiord}`), fetched by `src/render/basemap.ts`. Attribution is required on screen and on exported images (both do it). It is a free service with no agreement; going live needs a decision to keep it or host the tiles. Its "bright" style has filters on `ref_length` without a fallback, which makes MapLibre log three warnings per load (`highway-shield-non-us`, `highway-shield-us-interstate`, `road_shield_us`); they are the style's, not this app's.
- **Fonts** are self-hosted from `@fontsource-variable` packages (Newsreader, Libre Franklin, Noto Naskh Arabic, Noto Sans Arabic, all OFL). A cold load while offline shows fallback faces until the fonts arrive.

**Not done**

- **No Content-Security-Policy.** One needs at least `connect-src` for the API, the artifact base and `tiles.openfreemap.org`; `worker-src 'self' blob:` for the map worker; `img-src data: blob:` for exported images and patterns; and, for the embed, `frame-ancestors` set to whoever may embed.
- **Browsers cap live WebGL contexts** (16 in desktop Chrome, 8 on Android). The app keeps at most two alive (the compare view); a page that embeds many maps should lazy-load the iframes (`loading="lazy"`, which the snippet sets).

## Putting the existing livemap engine behind `EditorController`

The editor never touches MapLibre. Everything it asks of the map goes through `EditorController` (`src/editor/controller.ts`), created by an `EditorControllerFactory` in `src/screens/editor/use-controller.ts`. Swapping engines is swapping that one factory call. The contract speaks only the domain model: features, settings and viewports in, `change`, `select`, `tool`, `reshape`, `draw`, `pointer`, `viewport` and `problem` events out. The controller never owns the document; the store above it owns undo, saving and selection, and expects `gesture: "update"` while dragging and one `"commit"` at the end, so one drag is one undo step.

Two implementations already exist to copy from: `src/editor/engine/maplibre-controller.ts` (the real one) and `src/editor/engine/mock-controller.ts`, which records every call and draws nothing, and is the quickest way to see the exact order of calls the editor makes. `/dev/engine` (`src/editor/engine/harness.tsx`) exercises a controller on its own: fixtures, every tool, pitch and rotation, pane insets, pause, lost context.

An adapter can arrive in steps. Each step leaves the editor usable.

1. **Draw, read-only.** Implement the constructor (`ControllerOptions`), `whenReady`, `destroy`, `on`, `setFeatures`, `setSettings`, `setTheme`, `setDir`, `setDocument`, `setBasemap`, `getViewport`, `setViewport`, `project`, `unproject`, `getResolution` and the `ready`, `viewport` and `problem` events. Return no-ops for the rest and pass `interactive: false` behaviour. The editor then shows the map, the furniture, the list and the inspector, and saves whatever the list and inspector change. What the engine must draw to match the reader: free draw order across kinds (CC 1), colours as palette slots resolved per basemap (CC 9), fill patterns (CC 10), named and custom dashes (CC 11), label boxes and halos never under 1.01 px for Arabic (CC 12), icon and number markers (CC 13), annotation text at a coordinate with a straight or elbow leader (CC 14, 15), tapered arrows and the two-point arc with `bend` (CC 16), and front-line tooth shapes (CC 17). The embed and the image export use this front end's own renderer (`src/render/`), so anything the engine draws differently will differ between the editor and what readers see.
2. **Select.** `setSelection`, `select` events (click and box select, with `replace`, `add` and `toggle`), `pointer` events with hit ids, and `setTimeFilter` (only features valid in the window). The list, inspector, keyboard and palette then work against the map.
3. **Draw new shapes, one kind at a time.** `setTool`, `getTool`, `setDrawDefaults`, `cancel`, `finish`, the `draw` progress event (points, length, area, `canFinish`) and `change` with the new feature whole. Order by use: point, line, area, arrow, front line, annotation. A kind the engine cannot draw yet can be refused with `problem: "shape_rejected"`.
4. **Reshape.** `setReshaping`, the `reshape` event, vertex and midpoint handles, `setSnapping`. Set `capabilities.vertexEditing` and `snapping` honestly.
5. **Output and layout.** `exportImage` (or `capabilities.imageExport: false`; the export panel then says it is unavailable), and the three calls the editor makes to fit its layout, described below.

Today only `capabilities.imageExport` is read by the interface. If an engine sets `vertexEditing`, `snapping`, `fillPatterns`, `freeDrawOrder`, `timeFilter` or `touch` to false, the matching controls still show; wiring those flags to hide them is part of adopting a partial engine.

### Controller calls that exist for the editor's layout

These are not API changes and never reach a server. Any engine behind the seam has to honour them.

- **`setInsets({ top, bottom, start, end })`.** How much of the map the panes, the tool dock and the timeline cover, in CSS pixels, with `start` and `end` following the editor's direction. `fitFeatures` and `fitBounds` frame their target inside what is left, so nothing lands under a pane. It must not move the camera by itself.
- **`setRendering(enabled)`.** `false` while the full-screen preview covers the editor: the editor's map stays mounted (so the camera is exactly where it was on return) but draws nothing, leaving the preview's map the only one animating. The MapLibre implementation stops the camera, pauses its overlays and holds the map container at its current pixel size, because MapLibre redraws whenever its container is resized. `true` releases the size, resizes and paints once. Calls made while paused are kept.
- **`setLabelObstacles(boxes)`.** The on-screen rectangles of the furniture laid over the map (title block, key, credits, folded tabs), in CSS pixels from the map's top-left corner. Feature labels must move to another free place, or be left out, rather than sit under them. The editor measures them with `watchObstacles` (`src/render/obstacles.ts`) from every element marked `data-label-obstacle`; the embed does the same for its key, zoom buttons and scale bar.
