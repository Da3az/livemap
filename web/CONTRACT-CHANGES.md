# Contract changes

Every place where this front end's model (`src/model/types.ts`) and API (`src/api/client.ts`) depart from the existing API. Each entry gives the new or changed field or endpoint, why the interface needs it, and example JSON.

The comparison is against the description of the existing API that this build was given, not against its source code. Where that description did not say enough to tell whether something is a change, the entry is marked **to confirm**.

The examples are modelled on what the mock in `src/api/mock/` returns, trimmed to the fields being discussed. A few show a variant the seed data does not contain, such as a legend item that refers to a single feature.

## Summary

| # | Area | Existing | This front end |
|---|---|---|---|
| 1 | Draw order | `at`, banded by kind when drawn | `order`, free across kinds |
| 2 | Feature name | none | `name`, shown in the feature list |
| 3 | Groups | none | `groupId` on a feature, `settings.groups` on the map |
| 4 | Hidden and locked | none | `hidden`, `locked` on features and groups; editor-only |
| 5 | Style presets | none | `presetId` on a feature, `settings.presets` on the map |
| 6 | Validity dates | none | `validFrom`, `validTo` on a feature |
| 7 | Lineage | none | `lineageId` on a feature |
| 8 | Who changed a feature | none | `updatedAt`, `updatedBy` on a feature |
| 9 | Colour | hex string | palette slot or custom hex (`ColorRef`) |
| 10 | Fill pattern | accepted, never drawn | `none`, `hatch`, `cross`, `dots`; required and drawn |
| 11 | Dash style | optional `dash` | required `dash`: three named styles or a custom array |
| 12 | Label style | `labelStyle`, shape not given | a defined shape with halo, box and "ink" |
| 13 | Point | `at_`, `icon`, `iconColor`, `iconSize`, `disc?` | `at`, `symbol`, `color`, `size`; number markers |
| 14 | Annotation text position | `offset` in pixels | `textAt` as a coordinate |
| 15 | Annotation leader | `leader`, shape not given | `{ shape, anchorDot }` or `null` |
| 16 | Arrow | `chevrons` | `tapered` and `bend`; `chevrons` dropped |
| 17 | Front line | `facing`, `toothSpacing`, `toothSize` | adds `toothShape` |
| 18 | `meta` | on every feature | not in the model |
| 19 | Map settings | no storage | `settings` on the map |
| 20 | Opening view | `viewport`, fixed at creation | `settings.openingView`, set by the editor |
| 21 | Label language | `basemap.labelLangs` | `settings.basemap.labelLanguage`, one value |
| 22 | Legend | none | `settings.legend` |
| 23 | Title block and "as of" | none | `settings.titleBlock` |
| 24 | Timeline | none | `settings.timeline`, including the reader's window width |
| 25 | Embed options | none | `settings.embed` |
| 26 | Title | `title` | `title` as text with a direction (to confirm) |
| 27 | Draft ahead of live | `publishedVersion?` | adds `publishedRev` |
| 28 | Who changed the map | `updatedAt` | adds `updatedBy` |
| 29 | Archived | not on the map | `archived` on the map and in the list (to confirm) |
| 30 | Map list row | not described | `MapSummary` with `featureCount` and `thumbnail` |
| 31 | Settings travel with edit | `PATCH` for title and direction, no revision check | `title`, `uiDir`, `settings` inside the edit, under its revision check |
| 32 | Edit result | `{ rev }` | `{ rev, updatedAt }` |
| 33 | Stale-revision detail | `{ error }` only | adds `current: { rev, updatedBy, updatedAt }` |
| 34 | Force overwrite | none | `force` on the edit |
| 35 | What "unchanged" means | hash of features, viewport, basemap, title, direction | hash also covers `settings`; editor-only fields excluded |
| 36 | Published artifact | features and map fields | `MapVersion`, including `settings` |
| 37 | Version publisher | `publishedBy` is a user id | `publishedBy: { userId, name }` |
| 38 | Version origin | none | `origin`: publish from a revision, or rollback from a version |
| 39 | Artifact address | `storageKey` | adds `url` and `cacheControl` |
| 40 | Live pointer | not returned | `pointer` beside the version list |
| 41 | One version | not described | `getVersion` |
| 42 | Place search | none | `searchPlaces` |
| 43 | Errors | `{ error, reason?, message? }` | one shape with `reason`, `retryAfter`, `current`; one new code |
| 44 | Creating a map | not described | `{ title, uiDir, template }` and a template list |
| 45 | Session | not described | `Session` with capabilities, usage and limits |
| 46 | Guest terms | not described | `guest` on `AppConfig`: lifetime and limits of a guest workspace |
| 47 | Who made a map | none | `createdBy` on the map and the list row |
| 48 | Reader's poll | not described | anonymous pointer call with ETag, and one anonymous call per version |

---

## Features

### 1. Draw order: `order` replaces `at`

- **Change.** `at` (a base-62 key, with features banded by kind when rendered: areas under lines under points) becomes `order`. The key format is the same (base-62, fractional, compared as plain strings; see `src/model/order.ts`). What changes is the meaning: one sequence across all kinds, with no banding.
- **Why.** The feature list is the draw order and can be dragged. With banding, dragging an area above a line in the list would do nothing on the map. A fixed order by kind is a limitation Felt and Datawrapper both document against themselves (decision A.3). The rename also frees `at` for a point's position.
- **Server.** Drop the banding in the renderer. Existing keys stay valid; to keep today's appearance, re-key once so each band's keys sort after the band below.

```json
{ "id": "sh-024", "kind": "line", "order": "IZ" }
```

### 2. `name`: what the feature list shows

- **Change.** New required `name: RichText` on every feature. It is never drawn on the map. `label` stays as the optional text that is drawn.
- **Why.** A list of sixty features needs a name on every row, and most features have no label on the map. Reusing `label` would force text onto the map to make a row readable.

```json
{ "name": { "value": "حد منطقة الإخلاء الساحلية", "dir": "rtl" },
  "label": { "value": "منطقة الإخلاء", "dir": "rtl" } }
```

### 3. Groups

- **Change.** New `groupId: string | null` on every feature. New `settings.groups: FeatureGroup[]` on the map: `{ id, name, order, hidden, locked, collapsed }`. One level; a group's `order` places it among the groups in the list.
- **Why.** Conflict and disaster maps carry dozens of features per side or per theme; hiding or locking "all shelters" as a unit is daily work (L3).
- **Server.** A feature's `groupId` should be rejected or nulled when no such group exists. Deleting a group is an edit that removes it from `settings.groups` and re-homes its features in the same request.

```json
{ "settings": { "groups": [
  { "id": "sh-shelters", "name": { "value": "الإيواء والمستشفيات", "dir": "rtl" },
    "order": "F", "hidden": false, "locked": false, "collapsed": false } ] } }
```

### 4. `hidden` and `locked`

- **Change.** New required booleans on every feature and every group. Both are editor-only.
- **Why.** Hide a draft feature without deleting it; lock the control areas while placing icons on top of them (L2).
- **Server, at publish.** A feature is left out of the artifact when it is hidden or its group is hidden. In the artifact every remaining feature and group has `hidden: false` and `locked: false`, and groups have `collapsed: false`; a server may equally omit the three fields from the artifact, in which case the reader fills in `false`. None of the three takes part in the publish hash (entry 35), so toggling them alone publishes as `unchanged`.

```json
{ "id": "sh-069", "kind": "annotation", "hidden": true, "locked": false }
```

### 5. Style presets

- **Change.** New `presetId: string | null` on every feature. New `settings.presets: StylePreset[]`: `{ id, name, appliesTo: FeatureKind[], fill?, stroke?, iconColor? }`. When `presetId` is set the style comes from the preset; the feature's own `fill`, `stroke` and `color` are still present (the model requires them) and are ignored until the preset is removed.
- **Why.** "Restyle everything on side A" in one change, and a legend that can be generated from the presets in use (S4, S6). No tool studied has this for map annotations.
- **Server.** Store presets with the map. The renderer and the artifact reader resolve a feature's style through its preset.

```json
{ "id": "sh-orange", "name": { "value": "تحذير برتقالي", "dir": "rtl" },
  "appliesTo": ["area"],
  "fill": { "color": { "slot": 3 }, "opacity": 0.32, "pattern": "none" },
  "stroke": { "color": { "slot": 3 }, "width": 1.5, "opacity": 1, "dash": "solid" } }
```

### 6. Validity dates

- **Change.** New `validFrom: IsoDateTime | null` and `validTo: IsoDateTime | null` on every feature. `null` on either side is open-ended; both `null` means the feature is always shown.
- **Why.** The timeline (T2, T3) and the editor's date filter. The existing features carry no date at all: `at` is the draw-order key, not a time.

```json
{ "id": "wf-003", "validFrom": "2021-08-05T17:00:00.000Z", "validTo": "2021-08-07T17:00:00.000Z" }
```

### 7. Lineage

- **Change.** New `lineageId: string | null` on every feature. Features that share a value are successive states of one thing: a fire perimeter on day 1, 2 and 3, each with its own validity window.
- **Why.** Lets the list group the states, lets "new state from this one" copy a shape forward and close the previous window, and leaves room for interpolating between states during playback (decision A.4).
- **Server.** An opaque string. No constraint beyond storing it.

```json
[ { "id": "wf-001", "lineageId": "wf-perimeter", "validFrom": "2021-08-03T17:00:00.000Z", "validTo": "2021-08-04T17:00:00.000Z" },
  { "id": "wf-002", "lineageId": "wf-perimeter", "validFrom": "2021-08-04T17:00:00.000Z", "validTo": "2021-08-05T17:00:00.000Z" } ]
```

### 8. `updatedAt` and `updatedBy` on a feature

- **Change.** New on every feature. `updatedBy` is a display name. The server sets both on every feature it accepts in a `put`; values sent by a client are overwritten.
- **Why.** "Who touched this" in the inspector and in the version diff.
- **Server.** Neither takes part in the publish hash.

```json
{ "id": "sh-068", "updatedAt": "2026-11-21T10:35:25.631Z", "updatedBy": "مريم البلوشي" }
```

### 9. Colour: a palette slot instead of a hex value

- **Change.** Everywhere a colour was a hex string it is now `ColorRef`: `{ "slot": 1..8 }` or `{ "custom": "#rrggbb" }`. This applies to `Fill.color`, `Stroke.color`, a point's `color`, `StylePreset.iconColor` and `LabelStyle.color` (which also accepts the string `"ink"`).
- **Why.** One map has to read correctly on a light and on a dark basemap. A slot resolves to a different hex in each mode; a stored hex cannot (decision 2.6). Custom colours remain possible.
- **Server.** Stores the reference as given. The renderer resolves slots from the palette for the basemap mode in use. Migration of existing hex values: wrap as `{ "custom": hex }`.

```json
{ "fill": { "color": { "slot": 1 }, "opacity": 0.3, "pattern": "none" },
  "stroke": { "color": { "custom": "#5b6b3a" }, "width": 2, "opacity": 1, "dash": "solid" } }
```

### 10. Fill patterns

- **Change.** `Fill.pattern` was optional and accepted but never drawn. It is now required, one of `"none" | "hatch" | "cross" | "dots"`, and drawn by the editor, the reader and image export.
- **Why.** Solid against hatch is how uncertainty is drawn ("held" against "claimed"), and it is the fallback for colour-blind readers and for print (S3).

```json
{ "fill": { "color": { "slot": 5 }, "opacity": 0.2, "pattern": "hatch" } }
```

### 11. Dash styles

- **Change.** `Stroke.dash` was optional. It is now required: `"solid" | "dashed" | "dotted" | { "custom": number[] }`, the custom array being alternating dash and gap lengths in CSS pixels (that is how `src/render/style.ts` draws it; the named styles scale with the stroke width).
- **Why.** Named styles make a three-way control and stay consistent across features; the custom form keeps what the old field could express (S2).
- **Migration.** A missing `dash` becomes `"solid"`; an existing array becomes `{ "custom": [...] }`.

```json
{ "stroke": { "color": { "slot": 1 }, "width": 3, "opacity": 1, "dash": "dashed" } }
{ "stroke": { "color": { "slot": 1 }, "width": 3, "opacity": 1, "dash": { "custom": [6, 2, 1, 2] } } }
```

### 12. Label style

- **Change.** `LabelStyle` is defined as `{ color: ColorRef | "ink", size, weight: 400 | 600, halo: boolean, box: boolean }`. The existing API's shape for `labelStyle` was not described, so the differences are **to confirm**; `box` (a filled box behind the text) and `"ink"` (follow the basemap mode's text colour) are certainly new.
- **Why.** Text controls for weight, size, colour, halo and box background (X2). `"ink"` keeps default labels legible in both basemap modes.
- **Server.** The halo-width floor of 1.01 for Arabic text still applies wherever `halo` is drawn.

```json
{ "labelStyle": { "color": "ink", "size": 12, "weight": 600, "halo": true, "box": false } }
```

### 13. Points: `symbol`, and number markers

- **Change.** `{ at_, icon, iconColor, iconSize, disc? }` becomes `{ at, symbol, color, size }`.
  - `at_` → `at` (the name is free now that draw order is `order`).
  - `icon` → `symbol`, which is `{ "icon": IconId }` or `{ "number": "…" }` with up to three characters.
  - `iconColor` → `color` (a `ColorRef`), `iconSize` → `size` (CSS pixels).
  - `disc` is dropped: every marker is drawn on a disc.
  - `IconId` is a closed set of twelve: `strike, explosion, checkpoint, shelter, hospital, flood, fire, airport, port, camp, aid, pin`. **To confirm** against the existing icon set.
- **Why.** Number markers tie points on the map to a numbered list in the article (X3). One `symbol` field makes "icon or number" a single choice.

```json
{ "kind": "point", "at": [57.54, 23.81], "symbol": { "number": "9" }, "color": { "slot": 5 }, "size": 24 }
{ "kind": "point", "at": [58.284, 23.593], "symbol": { "icon": "airport" }, "color": { "slot": 1 }, "size": 22 }
```

### 14. Annotation text position: `textAt` replaces `offset`

- **Change.** `offset: [px, px]` from the anchor becomes `textAt: LngLat`, the coordinate where the text box sits.
- **Why.** A pixel offset means something different at every zoom and every embed width: a note placed clear of a coastline on a desktop lands on top of it on a phone. A coordinate holds its place.
- **Migration.** Project the anchor at the map's saved zoom, add the offset, unproject.

```json
{ "kind": "annotation", "anchor": [57.54, 23.81], "textAt": [57.2, 24.55],
  "text": { "value": "عبر مركز الإعصار الساحل بين المصنعة والسويق", "dir": "rtl" } }
```

### 15. Annotation leader

- **Change.** `leader` is `{ shape: "straight" | "elbow", anchorDot: boolean }`, or `null` for no leader. The existing shape was not described: **to confirm**.
- **Why.** Straight and elbow leaders are both in use in published examples; the dot marks exactly what the note points at (X1).

```json
{ "leader": { "shape": "elbow", "anchorDot": true } }
```

### 16. Arrows: `tapered` and `bend`, no `chevrons`

- **Change.** `{ control, curvature, head, chevrons }` becomes `{ control, curvature, bend?, head, tapered, stroke }`. `chevrons` is dropped.
  - `tapered: true` widens the shaft toward the head.
  - `head` is `"none" | "single" | "double"`.
  - `curvature` runs from 0 to 1. With three or more control points it blends straight segments (0) into a smooth curve through the points (1). With exactly two it is an arc: 0 is straight, 1 the fullest bow.
  - `bend`, optional, is `"left" | "right"`: which side of its direction of travel a two-point arc bows to. Absent reads as `"left"`. It has no effect with three or more points or at curvature 0. "Left" is fixed in map space (north of an arrow heading east), so the arc keeps its side when the map is rotated.
  - `stroke` is the full `Stroke`.
- **Why.** The tapered arrow is the movement arrow of every conflict map studied; chevrons along the shaft were not found in use. A curved two-point arrow is the quickest movement arrow to draw, and without `bend` it could only ever bow one way.
- **Server.** `bend` is stored and published like any other field. A renderer must draw the two-point arc the same way: a quadratic curve whose apex stands `0.18 × curvature` of the chord off the straight line, on the `bend` side, computed in Web Mercator.
- **Migration.** Arrows with `chevrons: true` become plain arrows. Existing arrows need no `bend`.

```json
{ "kind": "arrow", "control": [[57.35, 23.74], [56.95, 23.57], [56.55, 23.38]],
  "curvature": 0.6, "head": "single", "tapered": true,
  "stroke": { "color": { "slot": 5 }, "width": 5, "opacity": 0.7, "dash": "solid" } }
{ "kind": "arrow", "control": [[23.21, 38.84], [23.39, 38.84]],
  "curvature": 0.5, "bend": "right", "head": "single", "tapered": true,
  "stroke": { "color": { "slot": 1 }, "width": 3, "opacity": 1, "dash": "solid" } }
```

### 17. Front lines: `toothShape`

- **Change.** New `toothShape: "triangle" | "semicircle"` beside `path`, `facing`, `toothSpacing` and `toothSize`.
- **Why.** The two tooth shapes carry different meanings by convention (as on a weather chart), and the fire-front map in the seed uses the second.
- **Migration.** Existing front lines are `"triangle"`.

```json
{ "kind": "frontline", "facing": "left", "toothShape": "semicircle", "toothSpacing": 18, "toothSize": 7 }
```

### 18. `meta` is not in the model

- **Change.** The existing features carry `meta`. The front-end model has no such field and never sends it.
- **Why.** Nothing in the accepted feature set reads or writes it.
- **To decide.** Either the server keeps `meta` untouched when a feature is `put` without it, or `meta?: Record<string, unknown>` is added to `FeatureBase` so it round-trips. As the model stands, a `put` that replaces a feature whole would lose it.

---

## The map and its settings

### 19. `settings`: map-level storage

- **Change.** New required `settings: MapSettings` on `MapDoc` and on the published artifact. The existing API stores nothing at map level beyond `viewport`, `basemap`, `title` and `uiDir`. `settings` holds `basemap`, `openingView`, `presets`, `groups`, `legend`, `titleBlock`, `timeline` and `embed`; entries 3, 5 and 20 to 25 describe the parts.
- **Why.** Each part is something the editor sets once per map and the reader needs.
- **Server.** One JSON document per map, replaced whole by an edit (entry 31), included in the artifact and in the publish hash.

```json
{ "id": "m_shaheen", "settings": {
    "basemap": { "styleId": "positron", "labelLanguage": "ar" },
    "openingView": { "center": [58.9, 24.0], "zoom": 6.4, "bearing": 0, "pitch": 0 },
    "presets": [], "groups": [],
    "legend": { "show": true, "title": { "value": "مفتاح الخريطة", "dir": "rtl" }, "position": "bottom-start", "items": [] },
    "titleBlock": { "show": true, "subtitle": null, "source": null, "credit": null, "note": null, "asOf": null },
    "timeline": { "enabled": true, "mode": "cumulative", "speed": 7200, "windowMs": 21600000 },
    "embed": { "legend": true, "zoomButtons": true, "scaleBar": true, "cooperativeGestures": true, "static": false, "theme": "auto" } } }
```

### 20. Opening view

- **Change.** `MapDoc.viewport` becomes `settings.openingView: { center, zoom, bearing, pitch }`, and it changes only when the editor chooses "set opening view".
- **Why.** Today the published view is fixed by the template and cannot be changed after creation (P4). It must also not follow the editor's panning: where someone last looked is not what readers should open on.

```json
{ "openingView": { "center": [23.3, 38.89], "zoom": 10.2, "bearing": 0, "pitch": 0 } }
```

### 21. Label language

- **Change.** `basemap: { styleId, labelLangs }` becomes `settings.basemap: { styleId, labelLanguage }` with `labelLanguage: "ar" | "en" | "local"`. One value, not a list. `styleId` is one of `positron, bright, liberty, dark, fiord`.
- **Why.** An Arabic desk needs to pin the basemap's place names to Arabic for a map, whatever the reader's browser prefers (B2). `"local"` is each place's own language.
- **Migration.** Take the first entry of `labelLangs`; an empty list becomes `"local"`.

```json
{ "basemap": { "styleId": "positron", "labelLanguage": "ar" } }
```

### 22. Legend

- **Change.** New `settings.legend: { show, title, position, items }`. `position` is one of the four corners in logical terms (`top-start`, `top-end`, `bottom-start`, `bottom-end`), so it mirrors with the map's direction. Each item refers to a preset or to a single feature that has no preset, may override the label (`null` uses the preset's or feature's name), and may be hidden.
- **Why.** A legend appeared on every published map studied. Generating it from the presets keeps it true to the map; editable labels and order keep it readable (S6).
- **Server.** At publish, items that refer to a feature left out of the artifact are dropped.

```json
{ "legend": { "show": true, "title": { "value": "Key", "dir": "ltr" }, "position": "bottom-start",
    "items": [ { "ref": { "presetId": "eq-severe" }, "label": null, "hidden": false },
               { "ref": { "featureId": "eq-012" }, "label": { "value": "Fault rupture", "dir": "ltr" }, "hidden": false } ] } }
```

### 23. Title block and the "as of" stamp

- **Change.** New `settings.titleBlock: { show, subtitle, source, credit, note, asOf }`. The four text fields are `RichText | null`; `asOf` is `IsoDateTime | null` and `null` hides the stamp. The title itself stays on the map (`MapDoc.title`).
- **Why.** Title, source, credit and an "approximate" note are on every published example; the "as of" stamp is on every conflict map (X4, T1). It is set by the editor, not derived from the publish time, because a map is often published hours after the situation it shows.

```json
{ "titleBlock": { "show": true,
    "subtitle": { "value": "Where the ground broke on 6 February 2023", "dir": "ltr" },
    "source": { "value": "Sources: USGS, AFAD, UN OCHA", "dir": "ltr" },
    "credit": { "value": "Graphic: Al Mashriq", "dir": "ltr" },
    "note": { "value": "Province outlines are simplified.", "dir": "ltr" },
    "asOf": "2023-02-20T18:00:00.000Z" } }
```

### 24. Timeline

- **Change.** New `settings.timeline: { enabled, mode, speed, windowMs }`.
  - `enabled`: whether readers get a timeline. The author's own timeline in the editor works whatever its value.
  - `mode` is `"moving"` (only what is valid inside a window ending at the playhead) or `"cumulative"` (everything up to the playhead).
  - `speed` is seconds of map time per second of playback.
  - `windowMs` is the width of the moving window in milliseconds of map time. The author's timeline and the reader's use the same value: dragging the window's edge in the editor changes what readers get.
- **Why.** The reader's timeline bar and playback (T3), built on the validity dates of entry 6. The mode is an editorial choice per map: a storm track accumulates, a front line moves. The window is part of the same choice: a fire perimeter that changes daily wants a one-day window, a week of shelling wants a week.
- **Server.** Stored and published; nothing to compute. A reader treats a missing or unusable `windowMs` (absent, not a number, under one minute) as one day, so artifacts published before the field existed still play.

```json
{ "timeline": { "enabled": true, "mode": "moving", "speed": 21600, "windowMs": 86400000 } }
```

### 25. Embed options

- **Change.** New `settings.embed: { legend, zoomButtons, scaleBar, cooperativeGestures, static, theme }`. `cooperativeGestures` requires a modifier key or two fingers to zoom, so the article still scrolls. `static` is a picture of the map with no pan or zoom. `theme` is `"light" | "dark" | "auto"`.
- **Why.** The embed configurator (U3). The options live on the map so that every embed of it agrees and a change reaches articles already published.

```json
{ "embed": { "legend": true, "zoomButtons": true, "scaleBar": false,
    "cooperativeGestures": true, "static": false, "theme": "auto" } }
```

### 26. Title carries a direction (to confirm)

- **Change.** `MapDoc.title` is `RichText`: `{ value, dir }` with `dir` one of `ltr`, `rtl`, `auto`. The existing API's type for `title` was not described; if it is a plain string, this is a change.
- **Why.** An English title on a right-to-left map (and the reverse) is common, and every text-bearing field carries an explicit direction by the project's own rule.

```json
{ "title": { "value": "إعصار شاهين: المسار والتحذيرات ومراكز الإيواء", "dir": "rtl" }, "uiDir": "rtl" }
```

### 27. `publishedRev`

- **Change.** New `publishedRev: number | null` on `MapDoc` and `MapSummary`: the draft revision the live version was built from.
- **Why.** The publish control has three states (never published, live, draft ahead of live), and the third is `rev > publishedRev`. Without it the interface would have to publish to find out whether there is anything to publish (U1).
- **Server.**
  - After a publish, `publishedRev` is the revision that was published.
  - After a publish answered `unchanged`, `publishedRev` moves up to the current `rev`: the live version stands for that revision too.
  - After a rollback, `publishedRev` is the revision the restored version was originally built from, so the draft reads as ahead of live.

```json
{ "id": "m_shaheen", "rev": 97, "publishedVersion": 14, "publishedRev": 93 }
```

### 28. `updatedBy` on the map

- **Change.** New `updatedBy: string` on `MapDoc` and `MapSummary`: the display name of whoever last saved.
- **Why.** The workspace list shows who edited each map and when, and the stale-revision notice names the person.

```json
{ "updatedAt": "2026-11-21T10:35:25.631Z", "updatedBy": "مريم البلوشي" }
```

### 29. `archived` (to confirm)

- **Change.** `archived: boolean` on `MapDoc` and `MapSummary`; `archiveMap(id)` and `unarchiveMap(id)`; `listMaps({ archived })` returns the working maps for `false` and the archived ones for `true`. The description of the existing `MapDoc` has no such field, though a `map:archive` capability exists, so how much of this is new is **to confirm**.
- **Why.** The workspace has an archived view, and an archived map opened by its address must say so.

```json
{ "id": "m_beirut", "archived": true, "publishedVersion": 2 }
```

### 30. The list row: `MapSummary`

- **Change.** `listMaps` returns `MapSummary`: `{ id, slug, title, uiDir, rev, publishedVersion, publishedRev, updatedAt, updatedBy, createdBy, featureCount, archived, thumbnail }` with `thumbnail: { center, zoom, basemap }`. The existing list response was not described: **to confirm**. `createdBy` is entry 47.
- **Why.** The list shows state, last editor, feature count against the limit, and a small map, without loading any map's features.

```json
{ "id": "m_aftershocks", "slug": "aftershock-sequence-february-2023",
  "title": { "value": "Aftershock sequence, 6–20 February 2023 (density test)", "dir": "ltr" },
  "uiDir": "ltr", "rev": 212, "publishedVersion": null, "publishedRev": null,
  "updatedAt": "2026-11-21T09:13:25.631Z", "updatedBy": "Daniel Okafor",
  "createdBy": { "userId": "u_daniel", "name": "Daniel Okafor" },
  "featureCount": 4700, "archived": false,
  "thumbnail": { "center": [37.2, 37.6], "zoom": 7.2, "basemap": "dark" } }
```

### 47. `createdBy` on the map and on the list row

- **Change.** `MapDoc.createdBy: { userId: string; name: string }` and the same field on `MapSummary`. Set once, when the map is created; never changed by an edit.
- **Why.** A contributor's `capabilities` include `map:edit`, but the server allows it only on maps they created. Without the creator the interface learned this from a 403 on the first save. With it the workspace marks which maps are the contributor's own, offers "View" with the read-only padlock instead of "Open" on the others, and the editor opens those read-only. It also lets the list say who made a map, which `updatedBy` (a name only, entry 28) does not.

```json
{ "id": "m_shaheen", "rev": 48, "updatedBy": "Sarah Whitfield",
  "createdBy": { "userId": "u_layla", "name": "Layla Haddad" } }
```

---

## Saving

### 31. Title, direction and settings travel with the edit

- **Change.** `PATCH /maps/:id { title?, uiDir? }`, which has no revision check, is not used. `POST /maps/:id/edit` takes `title?`, `uiDir?` and `settings?` beside `rev`, `put` and `delete`, and applies all of it under the one revision check. `settings`, when present, replaces the stored settings whole.
- **Why.** One save, one revision, one undo history. A retitle that bypasses the revision check can silently overwrite a colleague's retitle. Presets, groups and the legend refer to features and features refer to them, so they have to change in the same atomic step: deleting a group and re-homing its features cannot be two requests.

```json
{ "rev": 97,
  "put": [ { "id": "sh-070", "kind": "point", "groupId": "sh-shelters" } ],
  "delete": ["sh-031"],
  "title": { "value": "إعصار شاهين: الحصيلة النهائية", "dir": "rtl" },
  "settings": { "basemap": { "styleId": "positron", "labelLanguage": "ar" } } }
```

(`put` items and `settings` are whole objects; they are cut short here.)

### 32. The edit result carries `updatedAt`

- **Change.** `{ rev }` becomes `{ rev, updatedAt }`.
- **Why.** The status bar's "saved at" should be the server's time, not the browser's clock.
- **Server.** `rev` increases by exactly one for each accepted edit, including an edit with nothing in it.

```json
{ "rev": 98, "updatedAt": "2026-11-21T10:47:02.114Z" }
```

### 33. Stale-revision detail

- **Change.** The 409 body gains `current: { rev, updatedBy, updatedAt }` and a `reason`.
- **Why.** "Someone else saved first" is not enough to act on. The notice has to say who and when, and the choice between reloading and keeping one's own work depends on it (C1).

```json
{ "error": "stale_revision",
  "reason": "Sarah Whitfield saved this map after you opened it.",
  "current": { "rev": 99, "updatedBy": "Sarah Whitfield", "updatedAt": "2026-11-21T10:46:40.902Z" } }
```

### 34. Force overwrite

- **Change.** New optional `force: boolean` on the edit. With `force: true` the revision check is skipped and the edit is applied to whatever the server holds.
- **Why.** The "keep mine" half of the stale-revision choice.
- **Server.** The edit is still a patch: features the other person added and this edit does not mention survive. `rev` still increases by one. The front end refetches the draft after a forced save for that reason.

```json
{ "rev": 97, "put": [], "delete": [], "force": true }
```

---

## Publishing and versions

### 35. What counts as "unchanged"

- **Change.** The publish hash covered features, viewport, basemap, title and direction. It now covers `title`, `uiDir`, the whole of `settings` (which contains the opening view and basemap) and the published features. It excludes: the version number and publish time; each feature's `updatedAt` and `updatedBy`; `hidden` and `locked` on features and groups; each group's `collapsed`; and every feature left out because it or its group is hidden.
- **Why.** A legend label, an embed option or the "as of" stamp is a change a reader sees, so it must publish. Locking a feature or collapsing a group is not, so it must not.
- **Server.** Hash a canonical form (sorted keys) so that key order cannot make equal content look different.

```json
{ "status": "unchanged", "version": 14, "etag": "\"105212e892a2570a8eb24469bb6f\"" }
```

### 36. The published artifact: `MapVersion`

- **Change.** The artifact is `{ mapId, version, title, uiDir, settings, features, publishedAt }`. New against the existing artifact: `settings` (entry 19) and the stripping rules of entry 4. Features are sorted by `order`.
- **Why.** The reader draws the legend, title block, timeline and embed controls from the artifact alone; the read path never touches the database.

```json
{ "mapId": "m_wildfire", "version": 4,
  "title": { "value": "North Evia wildfire: the perimeter day by day", "dir": "ltr" }, "uiDir": "ltr",
  "settings": { "timeline": { "enabled": true, "mode": "moving", "speed": 21600, "windowMs": 86400000 } },
  "features": [ { "id": "wf-001", "kind": "area", "hidden": false, "locked": false } ],
  "publishedAt": "2026-11-19T09:17:25.631Z" }
```

### 37. Version publisher name

- **Change.** `VersionRecord.publishedBy` was a user id. It is now `{ userId, name }`.
- **Why.** The version list shows who published each version (C2). A list of ids would need a second lookup that the API does not offer.

```json
{ "publishedBy": { "userId": "u_omar", "name": "عمر الفارسي" } }
```

### 38. Version origin

- **Change.** New `origin` on `VersionRecord`: `{ "type": "publish", "rev": n }` or `{ "type": "rollback", "fromVersion": n }`.
- **Why.** A rollback republishes an old version as a new one, so the list contains versions that are copies. Without `origin` the list cannot say "version 10: rollback to version 8", and the diff cannot explain why 10 equals 8.

```json
[ { "version": 10, "origin": { "type": "rollback", "fromVersion": 8 }, "publishedBy": { "userId": "u_layla", "name": "Layla Haddad" } },
  { "version": 9, "origin": { "type": "publish", "rev": 63 }, "publishedBy": { "userId": "u_daniel", "name": "Daniel Okafor" } } ]
```

### 39. Artifact URL and cache policy

- **Change.** New `url` (the full address of the artifact) and `cacheControl` on `VersionRecord`, beside the existing `storageKey`, `etag` and `byteSize`.
- **Why.** The versions screen links to the artifact and shows what readers' caches were told. Building the URL in the browser from `artifactBase + storageKey` would put a storage layout rule in the front end.

```json
{ "mapId": "m_shaheen", "version": 14, "etag": "\"105212e892a2570a8eb24469bb6f\"",
  "storageKey": "t/al-mashriq/cyclone-shaheen/v14.json",
  "url": "https://cdn.livemap.example/t/al-mashriq/cyclone-shaheen/v14.json",
  "byteSize": 37828, "featureCount": 65, "publishedAt": "2026-11-21T07:29:25.631Z",
  "cacheControl": "public, max-age=31536000, immutable" }
```

### 40. The live pointer

- **Change.** `listVersions` returns `{ pointer, versions }`. `pointer` is `{ version, url, etag, cacheControl, updatedAt }` for `latest.json`; `version`, `etag` and `updatedAt` are `null` when nothing is published.
- **Why.** The versions screen states which version readers are getting and how long a reader may hold a stale pointer (`max-age=5, stale-while-revalidate=30`), which is the honest answer to "is my rollback live yet".

```json
{ "pointer": { "version": 14,
    "url": "https://cdn.livemap.example/t/al-mashriq/cyclone-shaheen/latest.json",
    "etag": "\"105212e892a2570a8eb24469bb6f\"",
    "cacheControl": "public, max-age=5, stale-while-revalidate=30",
    "updatedAt": "2026-11-21T07:29:25.631Z" },
  "versions": [] }
```

### 41. Reading one version

- **Change.** `getVersion(id, version)` returns the `MapVersion` artifact (with a session); `getPublished(tenantSlug, mapSlug)` returns the live one anonymously, or `null` when the map has never been published. Whether the existing API offers these as endpoints was not described: **to confirm**. Both can be served straight from the artifact store (`VersionRecord.url` and the pointer) with no API endpoint at all.
- **Why.** Preview, the versions screen, and the diff between two versions, which needs both artifacts whole. The published-map specimen on the sign-in page uses `getPublished`. The embed itself polls with the two calls of entry 48 instead.

### Rollback

- **Unchanged in shape**, recorded for completeness: `rollbackMap(id, { toVersion })` answers `{ "status": "rolled_back", "version": n }` where `n` is the new version. The draft is not touched. The new version's record carries the origin of entry 38.

---

## New endpoints

### 42. Place search

- **Change.** New `searchPlaces(query, { language })` returning `PlaceResult[]`: `{ id, name, context, at, bounds }`. `name` is in the requested language with its direction; `context` is a short locating phrase ("Oman"); `bounds` is two corners or `null`. Pasted coordinates are parsed in the browser and never sent.
- **Why.** Finding a place is the first action on most breaking maps, and a desk types the name in Arabic as often as in English (P1). The existing API has no such endpoint.
- **Server.** Matching should ignore case, Latin accents and Arabic vowel marks, and treat the hamza forms of alif alike. Needs a session, so that the cost of a geocoder is not open to the public.

```json
[ { "id": "place-92", "name": { "value": "طرابلس", "dir": "rtl" }, "context": "ليبيا",
    "at": [13.191, 32.887], "bounds": [[13.071, 32.767], [13.311, 33.007]] } ]
```

### 44. Creating a map, and templates

- **Change.** `createMap({ title, uiDir, template })` with `template` one of `blank`, `conflict-tracker`, `storm-track`, `regional-results`, and `listTemplates()` returning `TemplateSummary[]`: `{ id, title, description, uiDir, featureCount }`. The existing create request was not described: **to confirm**.
- **Why.** A template now sets up presets, groups, the legend and the timeline, so the choice has to be described to the user before it is made.

```json
{ "title": { "value": "خريطة جديدة", "dir": "rtl" }, "uiDir": "rtl", "template": "conflict-tracker" }
```

### 45. Session and configuration

- **Not described in the reference**, so listed without a comparison. The front end reads:
  - `Session`: `{ userId, name, tenant: { id, slug, name }, role, capabilities, guest, expiresAt, usage: { maps }, limits: { maxMaps, maxFeaturesPerMap, maxVersionsPerMap }, artifactBase }`. `capabilities` is the list for the role (`map:read`, `map:create`, `map:edit`, `map:publish`, `map:archive`); `usage` and `limits` drive the quota warnings.
  - `AppConfig`: `{ artifactBase, guestSignup, humanCheckSiteKey, guest }`, public. `guest` is entry 46.

```json
{ "userId": "u_layla", "name": "Layla Haddad",
  "tenant": { "id": "t_almashriq", "slug": "al-mashriq", "name": "Al Mashriq Newsroom" },
  "role": "owner", "capabilities": ["map:read", "map:create", "map:edit", "map:publish", "map:archive"],
  "guest": false, "expiresAt": null, "usage": { "maps": 10 },
  "limits": { "maxMaps": 200, "maxFeaturesPerMap": 5000, "maxVersionsPerMap": null },
  "artifactBase": "https://cdn.livemap.example" }
```

### 46. Guest terms in the public configuration

- **Not described in the reference.** `AppConfig.guest` is `{ lifetimeHours, maxMaps, maxFeaturesPerMap, maxVersionsPerMap }`, or `null` when guest signup is off.
- **Why:** the sign-in page states what a guest workspace allows before anyone starts one. Those numbers are the server's limits; hard-coding them in the front end lets the page say one thing while the server enforces another. `Session.limits` carries the same numbers, but only after signing in.

```json
{ "artifactBase": "https://cdn.livemap.example", "guestSignup": true, "humanCheckSiteKey": null,
  "guest": { "lifetimeHours": 24, "maxMaps": 5, "maxFeaturesPerMap": 2000, "maxVersionsPerMap": 25 } }
```

### 48. The reader's poll: a pointer call with ETag, and one call per version

- **Change.** Two anonymous calls, beside `getPublished`:
  - `getPublishedPointer(tenantSlug, mapSlug, { ifNoneMatch })` returns the live pointer (`VersionPointer`, entry 40). Given the ETag it last saw, it answers `{ notModified: true }` when nothing was published since: a 304, no body. Otherwise `{ notModified: false, pointer }`.
  - `getPublishedVersion(tenantSlug, mapSlug, version)` returns one immutable `MapVersion`. The reader calls it once for each version the pointer names and keeps the answer.
- **Why.** The read path never touches the database, and the reader polls (every 10 seconds, and not at all while the tab is hidden). A poll of a few hundred bytes that is usually a 304 is what makes polling cheap; the artifact is fetched only when the pointer moves, and never twice for the same version, because it never changes.
- **Server.** These are plain reads from the object store and CDN: `GET {artifactBase}/t/{tenant}/{slug}/latest.json` with `If-None-Match`, and `GET {artifactBase}/t/{tenant}/{slug}/v{n}.json`. A 404 for the pointer is "never published" only if the map exists; see the open question in INTEGRATION.md section 4.

```json
GET /t/al-mashriq/cyclone-shaheen/latest.json    If-None-Match: "105212e892a2570a8eb24469bb6f"
→ 304 Not Modified                                (the client answers { "notModified": true })

GET /t/al-mashriq/cyclone-shaheen/latest.json
→ 200  ETag: "2c41b7f0e3a1d98c66f0a1b2c3d4"  Cache-Control: public, max-age=5, stale-while-revalidate=30
{ "version": 15, "url": "https://cdn.livemap.example/t/al-mashriq/cyclone-shaheen/latest.json",
  "etag": "\"2c41b7f0e3a1d98c66f0a1b2c3d4\"", "cacheControl": "public, max-age=5, stale-while-revalidate=30",
  "updatedAt": "2026-11-21T10:52:10.004Z" }

GET /t/al-mashriq/cyclone-shaheen/v15.json        → the MapVersion of entry 36
```

---

## Errors

### 43. One error shape, and one new code

- **Change.**
  - The body `{ error, reason?, message? }` is read as `{ error, reason?, current? }` plus the `Retry-After` header. `message` is not used. The front end wraps this as `ApiError { status, code, reason, retryAfter, current }`.
  - `reason` should be present on every refusal (403, 409, 413, 429, 503) as a sentence fit to show a user. The interface shows it in place, next to what was refused.
  - New code `guest_signup_disabled` (403), distinct from `forbidden`, for a server with guest workspaces switched off. The interface offers token sign-in instead of an error.
  - `quota_exceeded` covers three limits: maps in the workspace, features on a map, versions of a map. `reason` should say which and give the numbers.
  - Two codes exist only in the browser: `network` (the request never arrived) and `internal_error` (any 5xx that is not `guest_capacity`).
- **Why.** Every error and refusal is shown in place with its reason, never as a blocking dialog. That needs a sentence from the server and a stable code to choose the layout by.

| Status | Code | Extra |
|---|---|---|
| 401 | `unauthorised` | |
| 403 | `forbidden` | |
| 403 | `quota_exceeded` | |
| 403 | `human_check_failed` | |
| 403 | `guest_signup_disabled` | new |
| 404 | `not_found` | |
| 409 | `stale_revision` | `current` (entry 33) |
| 413 | `body_too_large` | |
| 429 | `rate_limited` | `Retry-After` |
| 503 | `guest_capacity` | `Retry-After` |

```json
{ "error": "quota_exceeded",
  "reason": "A map in this workspace can hold 5,000 features; this save would make 5,001." }
```

---

## Gaps noticed and left alone

These are not changes. They are places where the contract as it stands leaves the interface guessing; each would be a small additive change.

- **No code for an invalid request.** A feature with an open ring or a save with an unknown `groupId` has no error code to come back with; today's 400 would arrive as an unrecognised error.
- **No delete.** A map can be archived but not deleted, so a full guest workspace can only make room by archiving. The mock therefore does not count archived maps against `maxMaps`; the real rule is the server's to state.
- **`MapVersion` requires `hidden` and `locked`** because it reuses `MapFeature`. They are always `false` in an artifact. A separate published-feature type without them would be more exact.
