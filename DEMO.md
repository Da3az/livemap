# livemap — demo guide

Everything in this file has been run end to end and the outputs are real. Written
for someone who has never seen the code: no step assumes you remember anything.

**Repo:** https://github.com/Da3az/livemap

---

## The 30-second cheat sheet

Pin this to a second screen during the demo.

```bash
npm run db:up && npm run migrate   # Postgres + PostGIS on :5460
npm run demo                       # demo site          → :8800   (no DB needed)
npm run serve                      # production API     → :8787   (needs DB + secret)
npm run bench:serve                # load-test bench    → :8801
npm test                           # 249 tests
npm run spike                      # headless render + 18 assertions
npm run loadtest                   # full sweep, ~8 min
npm run db:down                    # stop the database
```

| URL | What you get |
|---|---|
| `http://127.0.0.1:8800/` | Index, links to everything |
| `/viewer.html?basemap=real` | The published map on real tiles |
| `/editor.html?basemap=real` | The authoring tool |
| `/api-demo.html` | **Click-through API demo — easiest way to show the backend** |
| `/embed.html` | The map inside a mock news article |
| `/viewer.html?poll=1&basemap=real` | Viewer with 5-second ETag polling on |

**If you have 10 minutes:** editor → viewer → `/api-demo.html` → the results
table in [loadtest/RESULTS.md](loadtest/RESULTS.md). Nothing else.

---

## Contents

1. [What this project is, in 60 seconds](#1-what-this-project-is-in-60-seconds)
2. [One-time setup](#2-one-time-setup)
3. [Pick a track](#3-pick-a-track)
4. [Track A — the 5-minute visual demo](#track-a--the-5-minute-visual-demo)
5. [Track B — the architecture claim (the strongest material)](#track-b--the-architecture-claim-the-strongest-material)
6. [Track C — multi-tenant security](#track-c--multi-tenant-security)
7. [Track D — the full 30-minute walkthrough](#track-d--the-full-30-minute-walkthrough)
8. [Talking points that land](#8-talking-points-that-land)
9. [Questions you will be asked](#9-questions-you-will-be-asked)
10. [Troubleshooting](#10-troubleshooting)
11. [Shutting down](#11-shutting-down)
12. [What is real and what is stubbed](#12-what-is-real-and-what-is-stubbed)

---

## 1. What this project is, in 60 seconds

> It's the backend and rendering engine for **live-event maps** — the maps a
> newsroom publishes during a breaking story. An editor colours regions, drops
> event icons, draws movement arrows and front lines, annotates, and hits
> publish. Readers get an embeddable map that updates as the story moves.
>
> It's Arabic-first, it's multi-tenant with isolation enforced in Postgres
> rather than in application code, and the central design claim — that the
> read path never touches the database — is backed by k6 load tests rather
> than by assertion.

If you only remember one sentence for the demo, use the last one. It's the
thing that makes this different from a CRUD app with a map on top.

**Scale:** ~11,000 lines across 5 packages, 249 tests, 41 commits.

---

## 2. One-time setup

You need **Node ≥ 18** and **Docker**. Nothing else is installed globally — k6
runs from its official container.

```bash
git clone git@github.com:Da3az/livemap.git
cd livemap
npm install
cp .env.example .env
```

**Then generate a session secret.** `.env.example` ships with
`SESSION_SECRET=replace-me`, and the server deliberately refuses to start on
the placeholder — so `npm run serve` will not boot until you do this:

```bash
node -e '
  const fs = require("fs");
  const s = require("crypto").randomBytes(32).toString("base64url");
  fs.writeFileSync(".env", fs.readFileSync(".env","utf8").replace(/^SESSION_SECRET=.*$/m, "SESSION_SECRET=" + s));
  console.log("SESSION_SECRET generated");
'
```

Only Tracks C and D need this — Tracks A and B run without it. If you change
the secret later, re-run `npm run bench:seed`, because existing tokens were
signed with the old one.

Start the database (PostGIS, on port **5460** so it won't collide with any
other Postgres you have running) and create the schema:

```bash
npm run db:up
npm run migrate
```

Expected:

```
applying 0001_init.sql ... ok
```

Sanity check the whole thing before you demo anything:

```bash
npm run build
npm test
```

Expected: **249 tests, 249 pass, 0 fail.** If you run `npm test` without the
database up, 8 integration tests skip and 241 pass — that's correct behaviour,
not a failure.

### Ports used

| Port | What |
|---|---|
| 5460 | Postgres + PostGIS (Docker) |
| 8800 | The demo site (`npm run demo`) |
| 8801 | The load-test bench server (`npm run bench:serve`) |
| 8787 | The production-style API (`npm run serve`) |

### Internet

The map labels and the optional real basemap are fetched from
`tiles.openfreemap.org`. **Demo on a connection.** Shapes still draw offline,
but text labels won't render, which undercuts the whole RTL story.

---

## 3. Pick a track

| Track | Time | Use when |
|---|---|---|
| **A — Visual** | 5 min | Anyone. Non-technical stakeholders. The "what is it" demo. |
| **B — Architecture** | 10 min | Backend/senior engineers. **This is your strongest material.** |
| **C — Security** | 5 min | Anyone who asks about multi-tenancy, or a security-minded interviewer. |
| **D — Full** | 30 min | A technical deep-dive where you have the floor. |

If you have 15 minutes with an engineer: do **A then B**. Skip the rest.

---

## Track A — the 5-minute visual demo

```bash
npm run demo
```

Expected:

```
  livemap demo

    http://127.0.0.1:8800/

  published v1  etag a93fb35ba29154298947e72a0df3e640
  14 features · in-memory repo · press Ctrl-C to stop
```

This boots the **real API** — the same `buildServer()` the production
entrypoint uses — over an in-memory repository, so Track A needs no database at
all. Open **http://127.0.0.1:8800/**.

### A1. The viewer (90 seconds)

Go to **Live viewer** → `/viewer.html?basemap=real`

You'll see a newsroom scene: a red *Contested* region, a green held region, an
orange dashed evacuation zone, a black toothed front line, curved red and blue
movement arrows with chevrons, event icons on coloured discs, and annotations
in both Arabic and English with leader lines connecting label to anchor.

The status bar at the bottom reads something like
`v3 · 14 features · etag a93fb35b… · published 10:00:07 PM`.

**Say this:**
> Every shape here is generated geometry, not an icon. There is no permissively
> licensed icon set anywhere that contains a front-line symbol, so the teeth are
> computed along the path. Same for the arrowheads — they're tangent to the
> *smoothed* curve, not to the control points, which is the bug you get if you
> do it the obvious way.

**Then zoom out two steps.** Point at the front line:
> Watch the teeth. They're denominated in pixels and converted per view, so the
> line reads correctly at every zoom. An earlier prototype sized them in metres;
> it looked perfect at the authoring zoom and fell apart everywhere else.

**Then point at an Arabic label:**
> The leader lines don't collapse when you zoom out because the label offset is
> stored in screen pixels, not degrees. And the halo around Arabic text is
> floored at 1.01 pixels — MapLibre draws halos per-glyph at 1px or below, which
> cuts the joins between Arabic letters. There's a test pinning that constant.

### A2. The editor (2 minutes)

Go to **Editor** → `/editor.html?basemap=real`

Toolbar: **Select (V), Area (A), Line (L), Arrow (R), Front line (F), Icon (I),
Note (N)**, then colour swatches, a width field and an icon dropdown. On the
right: **Undo, Redo, RTL / LTR, Preview, Save, Publish**. A right-hand panel
shows an **Inspector** and a **Features** list. A status bar sits at the bottom.

Do this, in order:

1. Press **A**, click three or four points on the map, double-click to close.
   → a coloured region appears, and the Features list grows.
2. Press **R**, click three points. → a curved arrow with an arrowhead.
3. Press **I**, click once. → an event icon on a disc.
4. Click a shape with **Select (V)** → the Inspector fills with its colour,
   width and label fields. Change the colour; the map updates immediately.
5. Hit **Undo** twice, then **Redo** once.
6. Hit **Save** → status shows `saved · rev N`.
7. Hit **Publish** → status shows `Published v4 · etag 6847254f…`.

**Say this:**
> Undo isn't a document snapshot. Every edit is a forward/reverse pair, so undo
> is just applying the reverse — which maps one-to-one onto row-level database
> writes. That matters because the alternative, storing one blob per map, is
> exactly how uMap lost user data and how Placemark ends up re-sorting its
> entire collection on every single edit.

### A3. RTL (30 seconds)

Click **RTL / LTR**.

The entire shell mirrors. **Say this:**
> There is not a single `[dir="rtl"]` layout override in the stylesheet. It
> mirrors purely from CSS logical properties. The one direction-specific rule in
> the whole file is a font choice, not a layout rule.

### A4. The embed (30 seconds)

Back to the index → **embed.html**

A mock article page with the map in a sandboxed iframe.

**Say this:**
> The iframe reports its height to the parent over postMessage, and the parent
> validates both the frame identity and the payload shape before trusting it.
> Validating only one of those is the standard way this becomes an XSS vector.

---

## Track B — the architecture claim (the strongest material)

This is the part that separates the project from a portfolio CRUD app.

### B1. The claim

> **The read path never touches the database.** Editors write to Postgres.
> Readers fetch immutable, content-hashed artifacts with ETags. There is no
> WebSocket fan-out, by design.

### B2. Show the publish lifecycle by hand (3 minutes)

With `npm run demo` running, open a second terminal. Every output below is real.

```bash
B=http://127.0.0.1:8800
```

**Read the map:**

```bash
curl -s $B/maps/m-1 | head -c 200
```

**Publish when nothing has changed:**

```bash
curl -s -X POST $B/maps/m-1/publish
```
```json
{"status":"unchanged","version":1,"etag":"a93fb35ba29154298947e72a0df3e640"}
```

> **Say:** Note `unchanged`, and a 200 rather than a 201 — nothing was created.
> The content hash deliberately excludes `publishedAt` and `publishedBy`, so
> republishing an identical map returns the identical ETag and every reader's
> cache stays warm. Hit publish ten times, readers re-download nothing.

**Fetch the artifact and look at the headers:**

```bash
curl -si "$B/public/t/demo-news/m/levant-tracker/v/1.json" | head -8
```
```
cache-control: public, max-age=31536000, immutable
etag: "a93fb35ba29154298947e72a0df3e640"
```

**Now ask for it again with that ETag:**

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download} bytes\n" \
  -H 'If-None-Match: "a93fb35ba29154298947e72a0df3e640"' \
  "$B/public/t/demo-news/m/levant-tracker/v/1.json"
```
```
304 0 bytes
```

> **Say:** A year-long immutable cache on the versioned object, and a 304 with
> zero bytes for a reader who already has it.

**The pointer object is cached completely differently:**

```bash
curl -si "$B/public/t/demo-news/m/levant-tracker/latest.json" | grep -i cache-control
```
```
cache-control: public, max-age=5, stale-while-revalidate=30, stale-if-error=90
```

> **Say:** Two objects, two policies. The version is immutable and cached for a
> year. The pointer that says *which* version is live gets a five-second TTL.
> That's how the BBC serves live results pages. `stale-if-error` means that if
> the origin dies mid-story, readers keep seeing the last good map instead of an
> error page.

**Optimistic concurrency — the failure that matters:**

```bash
curl -s -X POST $B/maps/m-1/edit -H 'content-type: application/json' -d '{"rev":99,"put":[]}'
curl -s -X POST $B/maps/m-1/edit -H 'content-type: application/json' -d '{"put":[]}'
```
```json
{"error":"stale_revision"}   # 409
{"error":"rev_required"}     # 400
```

> **Say:** A write must carry the revision it read. A stale writer loses rather
> than silently clobbering an edit it never saw — the failure mode that makes
> two people editing a live map untrustworthy. And the revision is *mandatory*;
> you can't opt out of the guard. 409 rather than 500, because the client should
> re-read and retry.

**Rollback:**

```bash
curl -s -X POST $B/maps/m-1/rollback -H 'content-type: application/json' -d '{"toVersion":1}'
```
```json
{"status":"rolled_back","version":3}
```

> **Say:** Rolling back to v1 produced **v3**, not a mutation of v1. The ledger
> is append-only, so the audit trail survives. v3's body and ETag are byte-identical
> to v1 — same content, new ledger entry.

There's a clickable version of this whole sequence at **`/api-demo.html`** —
buttons for *GET map*, *Add an incident*, *Publish*, *Publish again (unchanged)*,
*GET latest.json*, *Roll back to v1*. Use that if you'd rather not type.

### B3. The load tests (5 minutes)

Full reproduction is one command and about 8 minutes:

```bash
npm run loadtest
```

**Don't run that live in an interview.** Open
**[loadtest/RESULTS.md](loadtest/RESULTS.md)** and walk the tables. If you want
something live and quick, run one 20-second scenario instead:

```bash
npm run bench:seed 250
npm run bench:serve    # prints the mapId; leave running
```

In another terminal:

```bash
DURATION=20s VUS_LIST=200 MODES="db conditional" RUN_WS=0 bash loadtest/run.sh
```

**The headline, 500 concurrent readers, identical payloads:**

| Scenario | req/s | p95 | Data moved | DB connections |
|---|--:|--:|--:|--:|
| Read from Postgres per request | 408 | 1,272 ms | 459 MB | **10** |
| Immutable artifact, full `200` | 18,395 | 31 ms | 19,606 MB | **0** |
| Artifact + `If-None-Match` → `304` | **57,676** | **13 ms** | **255 MB** | **0** |

> **Say:** 141 times the throughput, 99 times lower p95, and 77 times less data
> than serving full bodies. But the column that matters is the last one. The
> artifact paths open *zero* database connections. CI asserts that — if a change
> makes the read path touch Postgres, the build fails.

**Then the two findings that show judgement rather than a ratio:**

**1. The conditional path doesn't care how big the map is.**

| Scenario | 250 features → 1000 features |
|---|---|
| Postgres per request | 396 → 114 req/s (**3.5× worse**) |
| Artifact, full 200 | 17,800 → 4,267 req/s (**4.2× worse**) |
| Artifact + `304` | 50,842 → 64,930 req/s (**flat**) |

> **Say:** Quadruple the map and the database path degrades with the row count
> it has to query and decode; the full-body path degrades with bytes pushed.
> The 304 path is flat, because a 304 never carries the body — it's a hash
> comparison either way.

**2. "Just raise the connection pool" makes it worse.**

| Pool | req/s | p95 | p99 |
|--:|--:|--:|--:|
| 10 | 114 | 1,788 ms | 1,825 ms |
| 50 | 118 | 2,054 ms | **7,929 ms** |

> **Say:** This is the obvious objection, so I tested it instead of assuming.
> Five times the connections bought 3.5% throughput and made the tail 4.3×
> worse. The pool was never the bottleneck — the per-request work was. A
> connection pool can't cache a result that was never cacheable.

**3. Be honest about the WebSocket result.** This earns more credibility than
the wins do:

> The WebSocket fan-out worked and it was fast — 500 subscribers, zero failures,
> 7ms p95 notification. Polling genuinely cannot match that latency. So the
> argument against it isn't performance; it's that the origin holds every reader
> for the entire session and a CDN can absorb none of it. That's an operational
> and cost argument. I also can't claim a per-connection memory cost from this
> rig — the RSS numbers were inside GC noise, and I say so in the results.

### B4. The verification habit

```bash
npm run spike
```

Takes about a minute. Expected tail:

```
z9.2-authoring         areas=3 lines=6 teeth= 37 markers= 29 labels=4 heads=3
z12-zoomed-in          areas=3 lines=3 teeth=259 markers=137 labels=1 heads=3
...
PASS  teeth increase zooming in (37 -> 259)
PASS  arrowhead rotations are view-independent
PASS  z12-zoomed-in: no overlapping labels
ALL ASSERTIONS PASSED
```

> **Say:** This renders the scene in headless Chromium across five views and
> asserts on the real output — tooth count goes 1, 4, 37, 259 across the zoom
> range while the arrowhead stays visually constant. Worth knowing: an earlier
> version of these assertions went green while three genuine defects were plainly
> visible in the screenshots. Structural assertions are necessary and not
> sufficient; I read the images too.

---

## Track C — multi-tenant security

Needs the database (`npm run db:up && npm run migrate`).

> **Frame it first:** Tenant isolation is enforced in Postgres, not in
> application code. Every tenant-scoped table has row-level security. A missing
> `WHERE tenant_id` in my code returns *nothing* rather than another newsroom's
> embargoed map.

Save this as `rls-demo.sh` and run it with **`bash rls-demo.sh`**. Run it in bash
specifically — it uses shell functions because zsh doesn't word-split a command
held in a variable, and fish won't accept this syntax at all.

```bash
#!/usr/bin/env bash
# Two tenants. Watch the application role fail to cross between them.

adm() { PGPASSWORD=livemap_dev     psql -h 127.0.0.1 -p 5460 -U livemap_migrator -d livemap -At "$@"; }
app() { PGPASSWORD=livemap_dev_app psql -h 127.0.0.1 -p 5460 -U livemap_app      -d livemap -At "$@"; }

# Setup runs as the migration role, which has BYPASSRLS — creating a tenant is
# inherently a cross-tenant operation.
adm -c "delete from tenants where slug in ('alpha','beta')" > /dev/null
adm -c "insert into tenants (slug,name) values ('alpha','Alpha News'),('beta','Beta Press')" > /dev/null
adm -c "insert into users (email,name) values ('e@alpha.test','A') on conflict (email) do nothing" > /dev/null
adm -c "insert into maps (tenant_id,slug,title,center,zoom,basemap_style_id,created_by)
        select t.id,'m1','Alpha Map',ST_GeogFromText('SRID=4326;POINT(31.2 30.0)'),8,'base',u.id
        from tenants t, users u where t.slug='alpha' and u.email='e@alpha.test'" > /dev/null
adm -c "insert into maps (tenant_id,slug,title,center,zoom,basemap_style_id,created_by)
        select t.id,'m1','Beta Map',ST_GeogFromText('SRID=4326;POINT(46.7 24.7)'),8,'base',u.id
        from tenants t, users u where t.slug='beta' and u.email='e@alpha.test'" > /dev/null

ALPHA=$(adm -c "select id from tenants where slug='alpha'")
BETA=$(adm  -c "select id from tenants where slug='beta'")
USER_ID=$(adm -c "select id from users where email='e@alpha.test'")

# Everything below runs as livemap_app, which does NOT own the tables.
echo "--- 1. no tenant set ---"
app -c "select count(*) from maps"

echo "--- 2. scoped to alpha ---"
app -c "set app.tenant_id = '$ALPHA'; select title from maps" | grep -v '^SET$'

echo "--- 3. alpha tries to UPDATE beta's map ---"
app -c "set app.tenant_id = '$ALPHA';
        update maps set title='HIJACKED' where tenant_id='$BETA'" | grep -v '^SET$'

echo "--- 4. alpha tries to INSERT a row into beta ---"
app -c "set app.tenant_id = '$ALPHA';
        insert into maps (tenant_id,slug,title,center,zoom,basemap_style_id,created_by)
        values ('$BETA','forged','Forged',ST_GeogFromText('SRID=4326;POINT(0 0)'),5,'base','$USER_ID')" 2>&1 | grep -v '^SET$'

echo "--- 5. the same insert into its OWN tenant ---"
app -c "set app.tenant_id = '$ALPHA';
        insert into maps (tenant_id,slug,title,center,zoom,basemap_style_id,created_by)
        values ('$ALPHA','legit','Legit',ST_GeogFromText('SRID=4326;POINT(0 0)'),5,'base','$USER_ID')" 2>&1 | grep -v '^SET$'

echo "--- 6. beta's map, untouched ---"
adm -c "select title from maps where tenant_id='$BETA'"
```

Real output:

```
--- 1. no tenant set ---
0
--- 2. scoped to alpha ---
Alpha Map
--- 3. alpha tries to UPDATE beta's map ---
UPDATE 0
--- 4. alpha tries to INSERT a row into beta ---
ERROR:  new row violates row-level security policy for table "maps"
--- 5. the same insert into its OWN tenant ---
INSERT 0 1
--- 6. beta's map, untouched ---
Beta Map
```

Step 5 is the control, and don't skip it — without it, steps 3 and 4 only prove
that *something* is broken. Together they prove the policy discriminates on
exactly the right thing.

**The four things to point at:**

1. **No tenant set → 0 rows.** It fails closed. A bug that forgets to set the
   scope returns an empty result, never a leak.
2. **`UPDATE 0`.** The cross-tenant update didn't error — it silently matched
   nothing, because the rows aren't visible to begin with.
3. **The insert is rejected outright** by the `WITH CHECK` clause. You cannot
   write a row into a tenant you aren't scoped to.
4. **The app role doesn't own the tables.** Say this one explicitly:

> A table owner bypasses RLS in Postgres. So if the application connected as
> the owner, all of these policies would be decorative. The app role is a
> non-owner, and `FORCE ROW LEVEL SECURITY` is set on top as a second layer.
> The migration role has `BYPASSRLS` because creating a tenant is inherently a
> cross-tenant operation.

**One more, if they're sharp.** Show them `packages/api/src/postgres.ts`:

```ts
await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
```

> The `true` is the entire ballgame. It scopes the setting to the transaction.
> A plain `SET` persists on the pooled connection after it's released, so the
> next request to borrow that connection inherits the previous tenant's scope.
> That's a cross-tenant data leak caused by a connection pool, and there's a
> test that pins it with a pool size of exactly 1.

---

## Track D — the full 30-minute walkthrough

Run A, then B, then C, then add these.

### D1. The production server for real

```bash
npm run db:up && npm run migrate
npm run bench:seed 50       # prints ids and a signed token
npm run serve               # listens on 8787
```

In a second terminal, set `TOKEN` and `MAP` from what the seed printed. Every
output below is real:

```bash
curl -s -w "  <- %{http_code}\n" http://127.0.0.1:8787/health
# {"ok":true}  <- 200

curl -s -w "  <- %{http_code}\n" http://127.0.0.1:8787/maps/$MAP
# {"error":"unauthorised"}  <- 401

curl -s -w "  <- %{http_code}\n" -H "Authorization: Bearer ${TOKEN}x" http://127.0.0.1:8787/maps/$MAP
# {"error":"unauthorised"}  <- 401   (one extra character invalidates the signature)

curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/maps/$MAP
# 200 — title "خريطة الاختبار", dir "rtl", 50 features, straight out of Postgres
```

> **Say:** Auth is HMAC-signed bearer tokens verified in constant time, with the
> length check *first* — `timingSafeEqual` throws on a length mismatch, which
> would itself leak the length. The tenant comes from the signed claims, so a
> client can't widen its own scope without the secret.

**Rate limiting** — writes only, keyed per actor:

```bash
for i in $(seq 1 70); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://127.0.0.1:8787/maps/$MAP/edit \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"rev":999}'
done; echo
# 60 responses get through, then 10 × 429
```

> **Say:** Reads aren't rate limited at all — the CDN absorbs those. Only writes
> are, and the key is the actor rather than the IP, so a newsroom behind one NAT
> doesn't rate-limit itself.

**Prove it fails safe.** Stop the database while the server keeps running:

```bash
docker compose stop db
curl -s -w "  <- %{http_code}\n" http://127.0.0.1:8787/ready
# {"ok":false}  <- 503

docker compose start db
# wait a few seconds for the healthcheck
curl -s -w "  <- %{http_code}\n" http://127.0.0.1:8787/ready
# {"ok":true}  <- 200
```

> **Say:** Liveness says the process is up; readiness runs an actual query
> through the pool. A failing database takes the instance out of the load
> balancer instead of returning 500s to readers — and note it recovered on its
> own, no restart needed.

### D2. The code tour — four files, in this order

| File | What to point at |
|---|---|
| `packages/core/src/arrow.ts` | Catmull-Rom spline; the arrowhead takes its bearing from the *smoothed* curve; the shaft is trimmed so the line doesn't show through the head. Zero dependencies — pure maths, unit-testable in Node without a browser. |
| `packages/core/src/collision.ts` | Label de-confliction by iterative relaxation. Note the relaxation factor below 1 — it stops two labels overshooting past each other and oscillating forever. And it *suppresses* a label it can't place rather than overlapping text. |
| `packages/api/src/publish.ts` | The pointer is written **last**, always. A version row with no object is invisible and gets reconciled. A pointer naming an object that doesn't exist is a broken map on air. |
| `migrations/0001_init.sql` | RLS policies, the non-owner app role, and the comment on `features.id`. |

### D3. The honest bug story

Open `packages/api/test/postgres.test.ts` and find
`"two tenants can use the same feature id"`.

> **Say:** This is my favourite bug from the project. Feature ids are generated
> client-side — the editor has to create a feature before any round trip so it
> can render the shape immediately. I'd made `features.id` a global primary key.
> Two tenants independently generating `arrow-1` collide, and the upsert's
> `ON CONFLICT` path then hits *another tenant's row* and fails the RLS check.
>
> Postgres reported it as `new row violates row-level security policy (USING
> expression)`, which reads like a policy bug. It's actually a key-scoping bug.
> The `(USING expression)` suffix maps to `WCO_RLS_CONFLICT_CHECK` in the
> Postgres source, which is specifically the `ON CONFLICT` path — meaning a row
> *was* found to conflict. That turns the question from "why is my policy wrong"
> into "whose row did I just collide with". Key is now `(map_id, id)`.

### D4. CI

Open `.github/workflows/ci.yml` and scroll to the last step.

> **Say:** CI spins up PostGIS, runs the migration, runs it *down* and back *up*
> to prove it's reversible, runs the tests, then runs a short k6 smoke and
> asserts the architectural invariant directly: after serving the artifact path
> 50 times, the Postgres pool must still report zero connections. The design
> claim is a build failure if it regresses, not a sentence in a README.

---

## 8. Talking points that land

Ranked by how well they land with senior engineers:

1. **"The read path never touches the database — and CI fails if it ever does."**
   Design claims backed by an automated check are rare in portfolio projects.
2. **"I tested the obvious objection and it lost."** Raising the pool 5× made
   p99 4.3× worse. Testing to *falsify* your own design reads as seniority.
3. **"The WebSocket version was faster, and I still didn't ship it."** Knowing
   why you rejected the thing that won on one axis.
4. **"A table owner bypasses RLS, so the app role doesn't own the tables."**
   A specific, non-obvious Postgres fact with a security consequence.
5. **"`set_config(..., true)` — the `true` prevents a cross-tenant leak through
   the connection pool."** Narrow, real, and has a test.
6. **"Rollback appends a new version."** Audit trails survive incidents.
7. **"RTL mirrors from logical properties alone."** Most people bolt RTL on with
   `[dir]` overrides and it rots immediately.

### Things to say out loud, unprompted

Volunteering limitations is persuasive and costs nothing here:

- "Artifacts are in an in-process store. Production wants S3 behind a CDN —
  it's one `ArtifactStore` implementation and nothing above it changes."
- "There's no identity provider. Tokens are minted out of band. I'd rather have
  an honest seam than a half-written auth system."
- "The editor can't reshape an existing polygon — you redraw it. Vertex editing
  is the next large piece of work."
- "The load tests run over loopback on one machine, so the ratios are the
  result and the absolute numbers aren't a capacity plan."

---

## 9. Questions you will be asked

**"Why not just use PostGIS with a tile server?"**
> For the basemap, absolutely — that's what the style URL points at. But event
> annotations aren't basemap data. They change every few minutes during a live
> story, they're authored by hand, and they're per-tenant and often embargoed.
> Vector tiles are the wrong unit for a few hundred editorial features that
> need to go live atomically.

**"Why not WebSockets? Everyone uses WebSockets."**
> I built it and measured it — `packages/api/src/realtime.ts`. It's fast: 7ms
> p95 to 500 subscribers. But the origin holds every reader for the whole
> session, so capacity scales with concurrent readers rather than with how often
> the story changes, and a CDN can absorb none of it. AP polls at 10s/120s with
> ETags, the BBC serves `max-age=5`, Al Jazeera's live tracker is a 24-hour
> cache over static JPEGs. Nobody at that scale holds a socket per reader.

**"Isn't 304-polling wasteful versus push?"**
> A 304 is a header exchange that a CDN edge answers without ever reaching my
> origin. The measured cost is 255 MB to serve 1.15 million requests to 500
> readers. The trade is latency: a reader on the slow lane can be up to 10
> seconds behind. For a live map, that's the right trade. For a trading app it
> would not be.

**"How would you scale this?"**
> The read path already scales horizontally to whatever the CDN does — it's
> stateless and the origin isn't in the path. The write path is the constrained
> side, and it's bounded by the number of *editors*, which is tens, not
> millions. The next bottleneck is publish throughput on very large maps, and
> the fix there is incremental artifact building rather than rebuilding the
> whole document.

**"What would you do differently?"**
> Scope the `features` primary key correctly from the start — see D3. And I'd
> write the clean-clone build test on day one; `npm run build --workspaces` runs
> packages alphabetically, so `api` built before `core` and only worked on my
> machine because a stale `dist/` was lying around. A fresh clone failed. That's
> the most embarrassing possible bug for a public repo and I caught it with an
> hour to spare.

**"How much of this is tested?"**
> 249 tests. The geometry is pure functions with no dependencies, so it's
> unit-tested directly. The publish pipeline is tested through a repository port
> with both in-memory and Postgres implementations. RLS has integration tests
> including a deliberate cross-tenant attempt. And rendering is verified in
> headless Chromium with structural assertions plus screenshots.

---

## 10. Troubleshooting

**`npm run demo` fails with "Not found handler already set"**
You're on an old checkout. `git pull` — fixed in `087008b`.

**Map renders but no text labels**
No internet. Glyphs come from `tiles.openfreemap.org`. Demo on a connection.

**Map renders nothing at all, 404 in console for a worker file**
`maplibre-gl-worker.mjs` must sit beside the bundle. `npm run demo` copies it
automatically; if you're running a custom build, that's the cause.

**`npm run migrate` → ECONNREFUSED**
Database isn't up or isn't healthy yet:
```bash
docker ps --filter name=livemap-db
docker compose up -d && sleep 5 && npm run migrate
```

**Port 5460 / 8800 / 8801 already in use**
```bash
ss -ltnp | grep -E '5460|8800|8801'
```
Change `BENCH_PORT` or `PORT`, or the port mapping in `docker-compose.yml`.

**8 tests "skipped"**
Correct when there's no database. `npm run db:up && npm run migrate` to run them.

**k6 can't write results / permission denied**
The k6 container runs as a non-root uid. The scripts pass
`--user "$(id -u):$(id -g)"`; if you're invoking docker by hand, do the same.

**Postgres container unhealthy on first start**
Postgres 18 images moved the data directory. The mount must be
`/var/lib/postgresql`, not `/var/lib/postgresql/data`. Already correct in
`docker-compose.yml`; only bites if you edit it.

---

## 11. Shutting down

```bash
# Ctrl-C any running demo / serve / bench process, then:
npm run db:down          # stops Postgres, keeps the data
npm run db:reset         # stops it and destroys the volume
```

The demo leaves nothing behind outside the repo and its one Docker volume.

---

## 12. What is real and what is stubbed

Be straightforward about this. The honesty is part of the pitch.

| Area | Status |
|---|---|
| Annotation geometry — arrows, front lines, leaders, de-confliction | **Real.** 129 tests. |
| MapLibre renderer | **Real.** Verified in headless Chromium. |
| Publish pipeline — versioning, ETags, rollback, reconciliation | **Real.** 45 tests. |
| Postgres persistence + row-level security | **Real.** Migration applied, 8 integration tests. |
| Auth — HMAC bearer tokens | **Real and tested**, but no login flow or identity provider. Tokens minted out of band. |
| Rate limiting, readiness, error handling, graceful shutdown | **Real.** 11 tests. |
| Viewer — polling, ETags, iframe embed | **Real.** 20 tests. |
| Load tests | **Real**, and reproducible with one command. |
| Editor | **Partial.** Draw, restyle, reorder, delete, undo/redo, publish. No vertex reshaping. |
| Object storage | **Stubbed.** In-process store behind an `ArtifactStore` port. |
| Billing | **Not built.** |
| Approval workflow, live feeds | **Schema only.** The tables exist; nothing reads them. |

### The one-line version

> It's a multi-tenant live-event map engine where tenant isolation is enforced
> by Postgres row-level security, the read path is immutable CDN artifacts that
> never touch the database, and that claim is proven by k6 load tests wired into
> CI rather than asserted in a README.
