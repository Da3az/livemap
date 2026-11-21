# livemap front end — Stage 1 research

Researched 2026-11-21. Nothing here is built yet; section 3 is the list to choose from.

## 0. How to read this

**Evidence tags**

- **SEEN** — the public page, asset, registry entry or source file was fetched directly.
- **DOCS** — the vendor's own help centre, academy, changelog or repository docs.
- **SECONDARY** — third-party write-ups. Used sparingly and marked.

**Limits you should know before trusting any of it**

- No authoring interface was operated. Felt, Mapbox Studio, Datawrapper, Flourish, Figma and Google My Maps sit behind logins, and no one logged in. Every claim about those editors is DOCS. The Kepler.gl demo and the QWC2 demo are reachable but are JavaScript apps that were not rendered.
- reuters.com, nytimes.com, ft.com, bbc.com, theguardian.com, apnews.com and bloomberg.com blocked the fetcher. The newsroom section therefore rests on Al Jazeera (English and Arabic), ISW, Liveuamap, Reuters' public basemap style and component repo, and what the desks have written about their own tooling. BBC Arabic maps were not seen at all.
- Static newsroom maps were inspected as markup, dimensions and colours, not viewed. In-image legends, arrows and Arabic label language in those images are **not observed**.
- No screenshots were taken. Links go to the vendors' own screenshots and doc pages.
- "Not found" means the docs did not state it, not that the feature is absent.

Spot-checked against primary sources after the research came back: MapLibre changelog entries for 6.9.0 and 6.19.0, and the npm registry entries for `terra-draw` and its MapLibre adapter. All three matched.

---

## 1. What each tool does well

### Felt — the best keyboard model and embed configurator (DOCS)

- **Drawing.** Single-key tools: Pin `P`, Line `L`, Polygon `O`, Rectangle `E`, Circle `I`, Text `Shift+T`, Note `Shift+N`, last tool `A`. Click per point, `Enter` to finish, click the first point to close. `Shift` snaps segments to 45°. "Snap to vertices" is a View-menu toggle. [Draw on the map](https://help.felt.com/annotations/draw-on-the-map), [shortcuts](https://help.felt.com/getting-started/keyboard-shortcuts)
- **Vertex editing.** Drag a vertex, drag a segment midpoint to add one, select a vertex and Delete, select an end vertex and Extend. [Edit annotations](https://help.felt.com/annotations/edit-annotations)
- **Measuring.** Distance, Area and Show radius are style toggles on the shape itself, so the measurement stays on the map. [image](https://217108486-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FmRfGitkyjOEMvVsEyGWN%2Fuploads%2Fgit-blob-531ab8437c888da730751b6b59436651dd795088%2Fannotation-measurements.webp?alt=media)
- **Layering.** One list for layers, groups and annotations. Drag to reorder, `]` / `[` for front and back, `Cmd+G` to group (no nesting), `H` hide, `Shift+Cmd+L` lock, Alt-click the eye to solo. [Organize layers](https://help.felt.com/layers/organize-layers)
- **Embed.** A configurator with a live preview that sets the opening view, with toggles for legend, search, basemap, measure, zoom buttons, scale bar, rotation, and scroll-zoom "with modifier key" versus "on scroll". [Embed a map](https://help.felt.com/share/embed-a-map), [image](https://217108486-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FmRfGitkyjOEMvVsEyGWN%2Fuploads%2Fgit-blob-0d77086347311d0f265bce1db8841a27a1ae392e%2Fembed-dialog.webp?alt=media)
- **Keyboard.** Command palette `Cmd+K`, shortcut sheet `?`, zoom to fit `F`.
- **Layout.** Top toolbar, legend/list panel on the left, a detail panel on the right that appears only on selection. [image](https://217108486-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FmRfGitkyjOEMvVsEyGWN%2Fuploads%2Fgit-blob-26288fcbc11829028e5692e620ee05bb96687aa2%2Fmap-parts.webp?alt=media)
- **Where it falls short for a news desk.** Its own docs state: no arrow tool, no version history, no publish step (every edit is live), no font or font-size control, single annotations cannot be hidden, undo is lost on reload. Label language follows the reader's browser and the author cannot pin it. [Undo changes](https://help.felt.com/maps/undo-changes.md), [basemaps](https://help.felt.com/layers/basemaps)

### Figma — the reference for panels, line ends, history and presence (DOCS)

- **Properties panel.** Right sidebar in a fixed order: position, size, text, Fill, Stroke, Effects, Export. With nothing selected it shows document-level settings. [Right sidebar](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar)
- **Stroke.** Solid, Dashed or Custom with Dash and Gap fields, dash cap, join, and separate start-point and end-point caps (line arrow, triangle arrow, round, square). This is exactly what Felt lacks for movement arrows. [Stroke properties](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties)
- **Layers panel.** Eye and padlock appear on row hover; dragging down the padlock column locks in bulk; locked layers stay selectable from the list. [Lock layers](https://help.figma.com/hc/en-us/articles/360041596573-Lock-and-unlock-layers)
- **Version history.** Autosave checkpoints grouped in a sidebar, named versions, and a restore that is non-destructive: it adds the pre-restore state and the restored state as new entries. That is the same model as livemap's "rollback republishes as a new version". [Version history](https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history)
- **Diff.** "Compare changes" with side-by-side and overlay modes and a clickable list of edited layers. Paid Dev Mode only. [Compare changes](https://help.figma.com/hc/en-us/articles/15023193382935-Compare-changes-in-Dev-Mode)
- **Shortcut sheet.** A panel docked at the bottom, tabbed by category, that does not block the canvas and marks the shortcuts you have already used. [Keyboard shortcuts](https://help.figma.com/hc/en-us/articles/360040328653-Keyboard-shortcuts-in-Figma)
- **RTL text.** Direction is auto-detected per text layer, with an override control that appears once the text contains an RTL script. [RTL text](https://help.figma.com/hc/en-us/articles/4972283635863-Add-right-to-left-text)
- **A lesson from its mistake.** The 2024 redesign shipped floating panels. The feedback thread drew 426 replies about lost canvas space, and fixed panels were restored three months later. [Forum thread](https://forum.figma.com/suggest-a-feature-11/launched-fixed-panels-are-back-23789) (SECONDARY, Figma's own forum)

### Mapbox Studio — the draft/publish split and the debug tools (DOCS)

- **Draft versus production.** Edits save to a draft; Publish, top right, updates production. This is the closest existing model to livemap's pipeline. [Studio interface](https://docs.mapbox.com/console-tools/studio/studio-interface.md)
- **Debug tools.** A colour-blindness simulator and a Language preview that do not affect the published style.
- **Layer list filter.** Filter layers by name, by value (a colour, a width), or by type.
- **Place search to feature.** In the legacy dataset editor a search result had "Save to dataset".
- **Where it falls short.** Only one step of revert ("Revert to last publish"). The draw editor was retired on 2026-06-01 and its replacement cannot edit older data. [Datasets](https://docs.mapbox.com/studio-manual/reference/datasets/)

### Datawrapper locator maps — the closest newsroom analogue (DOCS)

- **Marker list.** Search field, then the list, then the edit panel for the selection. List order is draw order. Groups are named folders. Each row reveals on hover an eye (`H`), a lock (`L`) and a viewport switch (`V`: all, desktop only, mobile only). Multi-select opens a bar with "select all" and "invert". [Organize markers](https://www.datawrapper.de/docs/how-to-organize-your-markers), [screenshot](https://kirby.datawrapper.de/media/pages/docs/how-to-organize-your-markers/9bfb2f2f96-1787819647/screenshot_2026-08-27_10-33-45@2x.png)
- **Keyboard.** A complete list model: arrows, Home/End, Shift+arrows to extend, `D` duplicate, `Cmd+G`, `Cmd+F`. [Shortcuts](https://www.datawrapper.de/docs/keyboard-shortcuts-in-locator-maps)
- **Place search.** One field takes a place name, pasted coordinates, or a Google Maps URL. [Add markers](https://www.datawrapper.de/academy/how-to-create-locator-maps-add-markers)
- **Arrows.** Handles at start, end and midpoint; the midpoint sets the curve. Two styles: a line with a head, or a tapered "flow". [Style arrows](https://www.datawrapper.de/docs/style-arrow-markers)
- **Labels.** An alignment dial around the point, text outline, a white-box background, and "draw line between marker and marker text". Text-only markers and three-character text icons give number markers. [Style point markers](https://www.datawrapper.de/docs/how-to-style-point-markers)
- **Copy and paste styles** with `Cmd+Shift+C` / `V`. No saved presets. [Copy/paste styles](https://www.datawrapper.de/docs/how-to-copy-paste-marker-styles)
- **Key.** Opt-in and manual: pick a symbol already on the map, type its text, drag to reorder, place above or below the map. [Key and annotate](https://www.datawrapper.de/docs/how-to-create-a-locator-map-annotate-give-your-map-a-key), [screenshot](https://datawrapper.de/cdn-cgi/image/quality=85,width=2222,f=auto,fit=cover/https://kirby.datawrapper.de/media/pages/docs/how-to-create-a-locator-map-annotate-give-your-map-a-key/8b64f83b5e-1777973141/file-ajgcvibojo.png)
- **Publishing.** Mobile, tablet and desktop preview buttons under the map. Three embed codes (script, responsive iframe, fixed iframe). Republish updates in place and increments a version in the URL. [Share and embed](https://datawrapper.de/academy/sharing-and-embedding)
- **Edit history.** Snapshots every 30 edits, on publish and after a minute idle; "Published version" and "Previous publish" labels; preview, Restore or Duplicate. No diff. [Edit history](https://www.datawrapper.de/academy/edit-history)
- **Map furniture.** Scale bar in km or miles, a north arrow that appears on its own past 40° rotation, inset locator map, title, description, notes, source, byline. [Design the map](https://www.datawrapper.de/academy/how-to-create-a-locator-map-design-the-map)
- **RTL.** Arabic output locales flip the published map to RTL, including map labels and the editor's text inputs. The editor interface itself has no Arabic and does not mirror. [RTL blog, 2022](https://www.datawrapper.de/blog/right-to-left-visualizations/), [localization](https://www.datawrapper.de/localization)
- **Where it falls short.** No in-editor drawing of lines or polygons at all; the docs send users to geojson.io. Dashes are solid or dashed only. Arrows are two-point. Readers cannot pan or zoom, by design. 500 point markers per map. [Import markers](https://www.datawrapper.de/academy/how-to-import-area-line-markers), [no zoom](https://www.datawrapper.de/docs/why-its-not-possible-to-zoom-in-published-locator-maps)

### Flourish — the publish button and approval gate (DOCS)

- **Publish state in one control.** The button is black when unpublished, green when live, and yellow with "Republish" when the draft is ahead of live. [Publishing](https://helpcenter.flourish.studio/hc/en-us/articles/8761565550607-Exporting-publishing-embedding-and-sharing), [screenshot](https://helpcenter.flourish.studio/hc/article_attachments/15291011055119)
- **Preview sizes.** Desktop, tablet, mobile and a custom size. [Mobile-friendly](https://helpcenter.flourish.studio/hc/en-us/articles/8761567966351-How-to-create-mobile-friendly-visualizations)
- **Approval workflow.** "Send for review" with named reviewers and a pending state. [Approval workflows](https://helpcenter.flourish.studio/hc/en-us/articles/8761559102607-Approval-workflows-in-Flourish)
- **Stories.** Slides that each store a view state, with animated transitions between them.
- **Where it falls short.** Nothing can be drawn. No version history found. RTL is text alignment only, and the vendor says it is incomplete.

### Kepler.gl — the timeline and the coordinates tools (DOCS, GitHub `master`)

- **Time bar.** Docked at the bottom: a histogram of features over time, a draggable window, play and speed. Three window modes: moving, incremental (cumulative), step by interval. [Playback](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/h-playback.md), [screenshot](https://d1a3f4spazzrp4.cloudfront.net/kepler.gl/documentation/h-playback-1.png)
- **Drawing.** Line and circle show a live length or radius label at the cursor. Vertex drag and click-to-insert. [Draw on map](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/draw-on-map.md)
- **Coordinates.** A pointer lat/lng readout, right-click "Copy coordinates", and saved camera bookmarks. [Interactions](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/g-interactions.md)
- **Legend.** Generated from visible layers and optionally included in image export.
- **Export image.** Choice of ratio and resolution, legend on or off. [screenshot](https://d1a3f4spazzrp4.cloudfront.net/kepler.gl/documentation/k-save-and-export-2.png)
- **Where it falls short.** No undo (issue open since 2019), no dashed lines, no publish step, RTL issues open and unanswered since 2021. It is an analyst's exploration tool, so only the time bar and coordinate tools transfer.

### Google My Maps (DOCS)

- **What transfers.** A search result becomes a temporary pin with "Add to map". "Set default view" fixes what readers open on. [Add places](https://support.google.com/mymaps/answer/3024925)
- **Where it falls short.** Ten layers, no lock, no groups, no arrows or text annotations, measurements vanish on the next click, no GeoJSON, no versioning.

### QGIS web clients — QWC2 and Lizmap (DOCS and source)

- **What transfers.** A bottom bar with coordinates, a scale selector and a scale bar (QWC2). Numeric coordinate entry for a vertex. Snapping configured per layer to vertices, segments and intersections (Lizmap). Node tool with `Del` on a hovered vertex. [QWC2 plugins](http://docs.qwc.app/master/references/qwc2_plugins/), [Lizmap editing](https://docs.lizmap.com/current/en/user/edition.html)
- **Where they fall short.** Neither has stepwise undo. Neither ships an Arabic, Hebrew or Persian locale. Lizmap is MPL-2.0, so it is reference only.

---

## 2. What newsrooms actually publish

From Al Jazeera English and Arabic (seven 2026 examples), ISW's public control-of-terrain map, Liveuamap, and Reuters' open components. Ranked by how often each appeared. The ranking does not reflect Reuters, NYT, FT, BBC, Guardian, AP or Bloomberg pages, which could not be loaded.

| # | Output | Seen in |
|---|---|---|
| 1 | A static portrait image, about 1080×1350 (4:5), with title, legend and credit baked in | Al Jazeera, five examples |
| 2 | A credit and source line, joint credits, and an "approximate locations" note | all |
| 3 | Control-area polygons in side colours | Al Jazeera, ISW, Liveuamap |
| 4 | Update in place: a new immutable file behind a short-cache pointer | Al Jazeera, Datawrapper embed, ISW |
| 5 | Time stepping: per-day tabs, frame sequences, before/now sets | Al Jazeera, Liveuamap |
| 6 | Point events coloured by actor, with tooltips | Al Jazeera, Liveuamap |
| 7 | A categorical legend placed outside the map | Al Jazeera, Liveuamap, Reuters |
| 8 | Named demarcation lines, solid and dashed | Al Jazeera, ISW |
| 9 | A muted basemap with labels above data and dashed disputed borders | Reuters |
| 10 | Confidence tiers: assessed versus claimed, as solid versus hatch and solid versus dashed outline | ISW |
| 11 | Animated GIF | Al Jazeera |
| 12 | Scroll-driven camera chapters | Al Jazeera |
| 13 | Locator inset and coordinate-pinned callouts with leader lines | Reuters components (described, not seen) |

**Not observed anywhere that could be inspected:** arrows, numbered markers, date sliders.

Things worth noting:

- **No web-interactive Arabic map was found.** On Al Jazeera Arabic, "الخريطة التفاعلية" refers to a TV studio segment; the article maps are a GIF and a JPG. Reuters' basemap style has no Arabic label field. This is the gap livemap is aimed at.
- **Al Jazeera fakes a timeline** with a hand-written row of links, one Datawrapper chart per day. That chart reached version 60 in four weeks. [Example](https://www.aljazeera.com/news/2026/3/16/map-shows-how-16-days-of-attacks-have-evolved-in-us-israel-war-on-iran)
- **ISW's confidence vocabulary** is a ready-made preset set: assessed control, assessed advances, claimed territory, claimed counteroffensives, infiltration areas, fortifications. [ISW map item](https://www.arcgis.com/home/item.html?id=9f04944a2fe84edab9da31750c2b15eb)
- **Liveuamap has a "show patterns instead of colours" toggle**, the only colour-blind accommodation found on any published map.
- **What the desks say slows them down.** FT (2016): deadline pressure "usually 90% of the time", QGIS then Illustrator then a responsive script. WSJ (2015): an editor-facing tool that deliberately limits options, whose maps are placeholders until a cartographer replaces them. Reuters: border inconsistency between sources, wrong-language OSM labels. [FT case study](https://qgis.org/project/case-studies/qgis_at_financial_times/), [Reuters basemap post](https://palewi.re/posts/2026/01/05/introducing-first-basemap/)

---

## 3. Enhancements to consider

**UI effort**, as front-end work against the mock: **S** about a day or less, **M** two to four days, **L** a week or more.
**Recommendation:** **Now** (this build), **Later** (design the slot, do not build), **Skip**.

### Layers

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| L1 | Feature list where order is draw order, drag to reorder, `]` / `[` | Datawrapper, Felt | M | Now | Required by the brief; everyone converges on this |
| L2 | Hide and lock per row, icons on hover, `H` / `L` | Datawrapper, Figma | S | Now | Cheap, and locking the control areas while placing icons is daily work |
| L3 | Groups, one level, hide/lock as a unit | Datawrapper, Felt | M | Now | Conflict maps carry dozens of features per side |
| L4 | Multi-select and bulk restyle | Datawrapper | M | Now | Restyling "all of side A" one by one is the deadline killer |
| L5 | Search and filter the list by name, kind or colour | Mapbox Studio | S | Later | Useful past about 50 features |
| L6 | Per-feature desktop-only / mobile-only visibility | Datawrapper | S | Later | Needs a contract change and embed support |

### Styling

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| S1 | Opacity for fill and stroke, separately | Datawrapper | S | Now | Already in the data shape |
| S2 | Line dash: presets plus custom dash/gap | Figma | S | Now | Dashed means "claimed" or "disputed" in every example |
| S3 | Fill patterns: hatch, cross-hatch, dots | ISW, Datawrapper (2020) | M | Now | Solid versus hatch is how uncertainty is drawn; also the colour-blind and print fallback |
| S4 | Named style presets per map ("Assessed control", "Claimed", "Side A") applied in one click | none for map annotations; Figma styles | M | Now | No studied tool has it; it also drives the legend |
| S5 | Copy and paste style | Datawrapper | S | Now | Cheap complement to S4 |
| S6 | Legend generated from the presets in use, labels editable, order draggable | Kepler.gl (auto), Datawrapper (manual) | M | Now | A legend appeared on every published map |
| S7 | Stroke caps and joins | Figma | S | Later | Barely visible at map stroke widths |
| S8 | Colour-blind preview, and a "patterns instead of colours" switch for readers | Mapbox Studio, Liveuamap | M | Later | Worth having; the categorical palette in Stage 2 covers the base case |

### Geometry

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| G1 | Vertex editing: drag, midpoint insert, delete, extend | Felt | M | Now | The existing product cannot reshape; front lines move daily |
| G2 | Snapping to vertices and edges of other features | Felt, Lizmap | S | Now | Adjacent control areas must share an edge without slivers |
| G3 | `Shift` constrains angle | Felt | S | Now | Trivial with the drawing library |
| G4 | Live length and area at the cursor while drawing | Kepler.gl | S | Now | Cheap and catches scale mistakes |
| G5 | Undo and redo | all | S | Now | Required |
| G6 | Undo history panel | Mapbox legacy editor | M | Later | Rare elsewhere; version diff covers the audit need |
| G7 | Persistent ruler or distance label as a feature | Kepler.gl, Felt | M | Later | New feature kind, needs a contract change |
| G8 | Typed coordinates for a vertex or point | QWC2, Datawrapper | S | Later | Desks do paste coordinates; P1 covers the common case |
| G9 | Union, subtract, split | Mapbox Data Workbench | L | Skip | GIS work; out of character for the tool |

### Place and navigation

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| P1 | Place search that takes a name or pasted coordinates, with "add as icon" on the result | Datawrapper, My Maps | M | Now | The first action on most breaking maps. Mock gazetteer in this build |
| P2 | Coordinates readout at the pointer, click to copy | Kepler.gl, QWC2 | S | Now | Lives in the status bar |
| P3 | Scale bar, km/miles | Datawrapper | S | Now | Built into MapLibre |
| P4 | "Set opening view" for the published map | My Maps, Felt | S | Now | Today the published view is fixed by the template and cannot be changed after creation (corrected 2026-11-21) |
| P5 | Saved views (bookmarks) | Kepler.gl | S | Later | Helpful on theatre-sized maps |
| P6 | North arrow that appears only when rotated | Datawrapper | S | Later | Only matters once bearing is used |

### Basemap

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| B1 | Basemap switcher (OpenFreeMap Positron, Bright, Liberty, Dark, Fiord) | Felt | M | Now | In the data shape already |
| B2 | Label language pinned by the author: Arabic, English, local | Mapbox Studio | M | Now | Nobody else lets an Arabic desk fix this per map |
| B3 | Toggle label, road and border sub-layers | Datawrapper, Kepler.gl | M | Later | Muting the basemap is good practice; one muted default covers most cases |
| B4 | Inset locator map | Datawrapper, Reuters | M | Later | Common in print-style maps, less so in embeds |

### Time

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| T1 | An "as of" stamp on the map, set by the editor | Al Jazeera titles | S | Now | Appeared on every conflict map |
| T2 | Date on each feature, shown and editable, and a date filter in the editor | Kepler.gl filters | M | Now | Needs new date fields. (Corrected 2026-11-21: `at` is the draw-order key, not a date; features carry no date today) |
| T3 | A timeline bar with histogram and playback, for readers | Kepler.gl | L | Later | Desks fake this by hand, so the demand is real, but it changes the viewer and the artifact |

### Text

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| X1 | Annotations with a leader line, straight or elbow | Datawrapper, Reuters | M | Now | In the data shape already |
| X2 | Text style: weight, size, colour, halo, box background | Datawrapper | S | Now | — |
| X3 | Number markers | Datawrapper | S | Now | Numbered events tied to a list in the article |
| X4 | Title block, source and credit line, "approximate" note | Datawrapper, Al Jazeera | M | Now | Present on every published example; needs a contract change |
| X5 | Rich text inside one annotation (mixed bold, links) | Datawrapper tooltips | M | Later | Bidirectional rich text is costly to get right |

### Import and export

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| I1 | GeoJSON import by drop, paste or file | Datawrapper | M | Now | How a desk gets a boundary from QGIS or a wire feed |
| I2 | GeoJSON export | Felt, Kepler.gl | S | Now | — |
| I3 | PNG export with presets (4:5 portrait, 16:9, 1:1), title, legend, credit and attribution | Kepler.gl, Felt | L | Now | The most common newsroom output in section 2 |
| I4 | CSV of points | Datawrapper, My Maps | M | Later | — |
| I5 | Print: PDF or SVG | Datawrapper, Felt | L | Later | Vector export from MapLibre is experimental everywhere |
| I6 | GIF or video | Kepler.gl, Flourish | L | Later | Tied to the open buyer-segment question in the project notes |
| I7 | CMYK | none found | L | Skip | — |

### Collaboration cues

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| C1 | "Edited by someone else" on a stale revision, with reload or keep-mine | — | S | Now | Required |
| C2 | Who published each version | Datawrapper | S | Now | Already in the data |
| C3 | Presence: who else has this map open | Figma, Datawrapper | M | Later | Needs a presence channel the API does not have |
| C4 | Comments pinned to the map | Figma, Felt | L | Later | — |

### Publishing

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| U1 | One publish control whose state reads: never published, live, draft ahead of live | Flourish | S | Now | State by word and colour together |
| U2 | Preview at phone, tablet, desktop and custom width | Flourish, Datawrapper | M | Now | Required |
| U3 | Embed options: responsive or fixed, legend, zoom buttons, scale bar, scroll-zoom with modifier, static mode | Felt, Datawrapper | M | Now | — |
| U4 | Diff between two versions: list of added, removed and changed features, plus side-by-side maps | Figma (paid); none for maps | L | Now | Nothing studied offers it for maps; it is what makes rollback safe |
| U5 | Overlay diff (swipe) | Figma, Mapbox compare | M | Later | After U4 proves useful |
| U6 | Scheduled publish | none found | M | Later | No scheduler exists in the backend |
| U7 | Request-to-publish approval | Flourish | M | Later | The `publish_requests` table exists and is unused |
| U8 | Unpublish | Datawrapper | S | Later | Needs a pipeline decision |

### Keyboard

| ID | Enhancement | Best example | Effort | Rec. | Why |
|---|---|---|---|---|---|
| K1 | Single-key tools | Felt | S | Now | Required |
| K2 | Command palette | Felt, Figma | M | Now | — |
| K3 | Shortcut sheet docked at the bottom, not a modal | Figma | S | Now | Matches the "never a blocking modal" rule |
| K4 | Full keyboard model for the feature list | Datawrapper | M | Now | Needed for accessibility anyway |
| K5 | Hide interface / focus mode | Figma, Felt | S | Later | — |

### Mobile and touch

No studied product supports authoring on a phone. Figma mobile is view and comment only; Felt ships a separate field app; Datawrapper and Flourish document nothing.

| ID | Enhancement | Effort | Rec. | Why |
|---|---|---|---|---|
| M1 | Tablet: the full editor with touch drawing | M | Now | The drawing library supports touch for select, point, line and polygon |
| M2 | Phone: review, retitle, publish and roll back; no drawing | M | Now | An editor away from the desk needs to publish or pull a map, not draw one |
| M3 | Phone: full drawing | L | Skip | No precedent and little room |

### Layout rules the evidence supports

- Panels docked to the edges, never floating (Figma's reversal).
- The inspector appears on selection and shows map-level settings when nothing is selected (Figma, Felt).
- A bottom status bar carries coordinates, scale, counts and save state (QWC2).

---

## 4. Build feasibility

Versions and licences from the npm registry and GitHub on 2026-11-21.

| Need | Candidate | Licence | Latest | Risk found |
|---|---|---|---|---|
| Drawing, vertex editing, snapping, undo | Terra Draw + MapLibre adapter | MIT | 1.40.0 (2026-11-15), adapter 1.5.0 | README lists MapLibre v4/5 only, though the peer range admits v6 and others report it working. No dashed polygon outlines (lines can be dashed since adapter 1.5.0), no feature lock (#928), `setStyle()` wipes its layers, rejects polygons with holes and Multi* geometries, select mode sees only its own store, upstream has no MapLibre tests |
| same | mapbox-gl-draw | ISC | 1.5.2 | No MapLibre support statement; 1.5.0 broke dashes on MapLibre; no snapping or undo |
| same | Geoman for MapLibre (free) | MIT | 0.10.10 | Pre-1.0 and changing weekly; undo and measurements are in the closed Pro tier |
| Measuring | Turf | MIT | 7.4.0 | Spherical area; one benchmark at 35–47° N found it 0.006–0.27% low. Fine for a readout |
| Place search | Nominatim public API | — | — | Policy forbids client-side autocomplete and caps at 1 request/second across all users |
| same | Photon | Apache-2.0 | — | Public server is throttled with no stated limit; Arabic coverage unverified |
| Basemap | OpenFreeMap | MIT (site) | — | No SLA; three machines. Open issue #137: Western Sahara borders not shown |
| Arabic labels | MapLibre ≥ 6.9.0 | BSD-3 | 6.19.0 | Native shaping, no plugin. Tiles carry `name:ar`; the style must be rewritten per layer to use it |
| Image export | MapLibre canvas | — | — | `preserveDrawingBuffer` is off by default; `maxCanvasSize` defaults to 4096² (configurable) and lowers the pixel ratio silently above it |
| Command palette | cmdk (shadcn Command) | MIT | 1.1.1 (2025-03) | No release in 20 months; open accessibility issues (#413, #417) |
| Drag to reorder | @dnd-kit/core + sortable | MIT | 6.3.1 (2024-12) | No release in two years; the rewrite is still 0.x with a React 19 Strict Mode bug (#2116) |
| same | pragmatic-drag-and-drop | Apache-2.0 | 4.0.0 (2026-09) | Not investigated further |
| same | react-aria-components | Apache-2.0 | 1.22.1 (2026-10) | Not investigated further |

**Recommendation on the drawing library.** Terra Draw for point, line and polygon editing, with arrows, front-line teeth, patterns and dashes rendered in livemap's own layers. Its gaps fall on things the product draws itself anyway. This keeps the later choice open of putting the existing engine behind `EditorController`.

---

## 5. Findings that touch the existing project

- **Halo rule.** MapLibre 6.19.0 lists "draw the text halo in a separate pass for cursive scripts" (#9009). The research ties this to issue #8949, the reason for the 1.01 minimum halo width. The repo has 6.16.0 installed, so the rule still applies there; it may be unnecessary after an upgrade. Not tested.
- **`setWorkerUrl`.** The project notes say it does not exist in 6.16. The installed 6.16.0 exports it in both the type definitions and the `.mjs`, and it is the documented bundler recipe. Not executed here.
- **Western Sahara on OpenFreeMap.** An editorial risk for an Arabic newsroom audience that no front-end code can fix.
- **OpenFreeMap attribution** is required on exported images too, which affects I3.
