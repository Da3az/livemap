# livemap design — "Atlas"

The direction chosen on 2026-11-21 from three samples (`stage2/index.html`). Tokens live in `src/styles/tokens.css`; this file says what they are for and how the built interface uses them. Every component in every state is on `/dev/kit`; every screen in every state is on `/dev/states`.

## The idea

A printed atlas and the newspaper it sits in. The published map's furniture — title, key, credit — is treated as typography, in a news serif. The working controls around it are a plain newspaper sans, flat and quiet, so the map and its colours are the loudest thing on screen.

## Type

| Role | Latin | Arabic | Where |
|---|---|---|---|
| Title | Newsreader 500/600 | Noto Naskh Arabic 500/600 | Map title, pane titles, the map key heading, export title block |
| Interface | Libre Franklin 400/500/600 | Noto Sans Arabic 400/500/600 | Every control, list row, status |

- Newsreader was drawn for news text; Libre Franklin revives the classic newspaper sans. Naskh is the style of Arabic news text.
- All four are SIL Open Font Licence and are self-hosted, not loaded from a font service.
- Numbers in lists, dates, coordinates and counts use tabular figures.
- Western digits in both languages, matching Al Jazeera Arabic's practice.
- Sizes: 11, 12, 13 (the working size), 15, 17 (pane titles), 23 (map title). No other sizes.
- No monospace anywhere. Hex values and coordinates are set in the interface face with tabular figures.

## Colour

Every colour has one job. Values are in the tokens file for light and dark.

| Token | Light | Dark | Job |
|---|---|---|---|
| Survey green | `#1C6B50` | `#5CC49C` | Primary actions, Publish, the selected row |
| Contour plum | `#7A3A6C` | `#D690C6` | Selection on the map, vertex handles, timeline window, group headings |
| Bathymetric blue | `#27599A` | `#82B2EC` | Links, information, focus ring |
| Success | `#1C6B50` | `#5CC49C` | Saved, published |
| Warning | `#935600` | `#E9A54A` | Quota near limit, rate limited |
| Danger | `#A8281E` | `#F27D6E` | Refusals, destructive actions |
| Information | `#27599A` | `#82B2EC` | Notices |

Neutrals carry a grey-green tint in eight steps: page, panel, well, rule, strong rule, and three text strengths.

### States

Colour is never the only signal. Each state has a shape and a word.

| State | Shape | Colour |
|---|---|---|
| Draft | hollow circle | warning ochre |
| Unsaved | solid diamond | burnt orange |
| Live | dot in a ring | survey green |
| Archived | hollow square | grey |
| Guest | hourglass | plum |
| Read-only | padlock | blue |

### Map features

Eight categorical colours, in a fixed order, with one set for a light basemap and one for a dark basemap. A feature stores the slot, not the hex, so a map keeps its meaning in both modes.

| Slot | Name | Light | Dark |
|---|---|---|---|
| 1 | Vermilion | `#B0250F` | `#D72623` |
| 2 | Ultramarine | `#3854C3` | `#5D51FD` |
| 3 | Ochre | `#CFA200` | `#CD8100` |
| 4 | Forest | `#136A42` | `#087956` |
| 5 | Plum / Mauve | `#863079` | `#B02EAF` |
| 6 | Sky | `#2FA3E7` | `#1094EF` |
| 7 | Rose | `#BE639B` | `#B37DB4` |
| 8 | Moss | `#689339` | `#63A770` |

- Checked with a colour-blindness validator across all 28 pairs. Light: weakest colour-blind pair 8.5 against a target of 8, weakest normal-vision pair 15.9 against a floor of 15. Dark: 9.0 and 16.0.
- On the light basemap, ochre and sky are under 3:1 against the land colour, so filled areas always carry an outline and lines in those colours get a casing.
- Patterns (hatch, cross-hatch, dots) are the second channel for colour-blind readers and for print.
- A custom colour outside the eight is allowed; it is user data, not a token.

## Layout

The editor, at desktop width:

```
┌ Maps │ Title · Rev.  Undo Redo │ ○ Saved 12:03 [Save] │ Editor Preview │ Import / Export ┃ ( ○ 9 changes not live [Publish] ) History ┐
├──────────────┬──────────────────────────────────────────────────────────┬────────────────┤
│ Features  39 │  [title block]          [place search]        [Map settings]│ Inspector      │
│ groups, rows │                                                          │ (or Map        │
│              │  [key]                                                    │  settings)     │
│              │              ( next-shape strip )                        │                │
│              │         ( Select Area Line Arrow Front Icon Text · Snap )│                │
│              │       ( Play  ▮▮▮▮ histogram ▮▮▮  window  Readers: on )  │                │
├──────────────┴──────────────────────────────────────────────────────────┴────────────────┤
│ Centre · Zoom · Scale            39 features · Labels · Title and key [As published|Folded|Hidden] · Snapping │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Panes are docked flush, square, with a hairline rule.** The feature list sits on the leading side. The trailing pane is the inspector while something is selected and Map settings when nothing is; with neither open the map takes the width, and a tab at the map's top corner brings each back. Both collapse with a shortcut.
- **The top bar** holds the way back, the title with its revision, undo and redo, the save badge, the Editor | Preview switch, Import / Export, and, set apart, the publish pill with History. Map direction is not in the bar: it is a property of the map, set in Map settings and from the command palette.
- **Save is a state first.** The badge says where the draft stands (saved at a time, or how many unsaved changes, with the unsaved diamond); the Save button beside it fills in only when there is something to save.
- **Editor | Preview are underlined tabs**, not filled segments, so they never read as one more setting. Preview covers the map with the reader's view at phone, tablet and desktop widths; the editor's map stays where it was underneath, paused.
- **The publish pill** gives the live state in words ("Live · v4", "9 changes not live", "Never published") and the one button that changes what readers see. The longer "Publish changes" and the live line appear from 1536 px.
- **The furniture switch** in the status bar shows the published title block, key and credits over the map "As published", "Folded" to one-line tabs, or "Hidden". Any part also folds on its own, fades while a shape is drawn and steps aside under the pointer. Feature labels keep out from under it.
- **Tools live in a pill dock over the bottom of the map**, each with a word and its key. Above it, the next-shape strip holds the colour, preset and the options of the active tool only (an arrow's head, body, curve and flip). Below it, the timeline: a pill with play, the histogram of dated features, the window, and whether readers get a timeline.
- **Tablet (834):** panes slide over the map instead of sitting beside it. With one open the dock goes compact: icons with their key letter, the active tool keeps its word, and the colours fold behind one swatch. **Phone:** review, retitle, save, preview, publish; no drawing.
- **The shell** (sign-in, workspace, versions) is English and left to right. Sign-in shows the two ways in beside a live published map from 1280 px. The workspace is a table: title, state, features against the limit, revisions ahead of live, direction, when and by whom, and the row's actions; a contributor's maps that are not theirs offer "View" with the read-only padlock.

## Density

Tight where work happens, open where it does not.

| Element | Size |
|---|---|
| Feature list row | 32px |
| Control height | 28px |
| Dock tool | 36px |
| Top bar | 56px |
| List pane / trailing pane | 288px / 316px |

The sample used 35px rows. They are 32px here so more features fit without losing the direction's calm.

## Shape and depth

- Radius follows the job: 4px for the map key and title block (printed, hard-edged), 6px for fields and swatches, 8px for grouped blocks and the selected row, full pills for the dock, the publish control and the timeline. Panes themselves are square because they are docked.
- Panes are flat with a hairline rule. Only things that float over the map are lifted: the dock has a hard 2px offset, popovers a soft shadow.
- No gradients, no glass, no glow.

## Icons

- A word wherever there is room for one. Tools, commands and state all carry words.
- Icons are used for feature kinds in the list (they double as the colour chip), for hide and lock on a row, and for states.
- One drawn set, 16px grid, 1.4px stroke, no fills except to show a feature's colour.
- On touch, hide and lock are always visible on the selected row, since there is no hover.

## Motion

Short and functional: 120ms for hover and press, 200ms for a pane opening. Nothing loops. Timeline playback is the only continuous motion. `prefers-reduced-motion` turns transitions off.

## Right to left

- Logical properties only; no `left` or `right` in component styles.
- The editor can switch direction at runtime while the rest of the app stays left to right. Popovers, menus and dialogs opened from the editor mount inside the editor so they inherit its direction.
- User-entered text carries its own direction.
- Time on the timeline runs right to left when the editor is right to left.

## Accessibility

- AA contrast for all text and controls in both modes; the swatch page shows each computed ratio.
- Visible focus ring in bathymetric blue on every interactive element.
- The feature list is the keyboard route to everything on the map: select, reorder, hide, lock, delete and restyle without touching the canvas.
- Errors and refusals appear in place, never in a blocking dialog.

## What still looks generic, and the guard against it

- Rounded blocks on a tinted page with pill buttons is close to a consumer web app. Guard: square docked panes, hairline rules, the serif titles, and the hard-edged map key.
- The inspector is a stack of similar rows. Guard: controls shaped by their job — a swatch with a pattern preview, a dash picker that draws the dash, a slider only where a value is continuous.
