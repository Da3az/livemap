#!/usr/bin/env node
// Deletes guest workspaces past their time to live.
//
//   node --import tsx scripts/reap-guests.mjs            delete expired guests
//   node --import tsx scripts/reap-guests.mjs --dry-run  list them, change nothing
//
// MUST BE SCHEDULED. Nothing in the server runs this: there is no in-process
// scheduler, by decision. Until it runs, expired workspaces keep counting
// against MAX_GUESTS, and when that ceiling is reached signup answers 503.
// The schedule itself is infrastructure and does not live in this repository.
//
// Connects as livemap_admin: finding every guest tenant is cross-tenant by
// definition, and the migration role could do it too but can also run DDL.

import pg from "pg";
import {
  GUEST_SLUG_PREFIX,
  GUEST_TTL_SECS,
} from "../packages/api/src/limits.ts";
import { r2FromEnv } from "../packages/api/src/r2.ts";
import { keys } from "../packages/api/src/storage.ts";

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;
if (!ADMIN_DATABASE_URL) {
  console.error("ADMIN_DATABASE_URL is not set. Copy .env.example to .env.");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const unknown = process.argv.slice(2).filter((a) => a !== "--dry-run");
if (unknown.length > 0) {
  console.error(`unknown argument: ${unknown.join(" ")}`);
  process.exit(1);
}

// A guest's published maps are public objects, so they go with the workspace.
// Without R2 configured there is nothing durable to delete: the in-memory
// store belongs to the server process and dies with it.
let store;
try {
  store = r2FromEnv(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });

try {
  await client.connect();

  const { rows: expired } = await client.query(
    `select t.id, t.slug, t.created_at,
            (select count(*)::int from maps m where m.tenant_id = t.id) as maps
       from tenants t
      where left(t.slug, $1) = $2
        and t.created_at < now() - make_interval(secs => $3)
      order by t.created_at`,
    [GUEST_SLUG_PREFIX.length, GUEST_SLUG_PREFIX, GUEST_TTL_SECS],
  );

  if (expired.length === 0) {
    console.log("no expired guest workspaces");
  }

  let reaped = 0;
  for (const t of expired) {
    const line = `${t.slug}  created ${t.created_at.toISOString()}  ${t.maps} map(s)`;
    if (dryRun) {
      console.log(`would delete  ${line}`);
      continue;
    }

    // Objects before rows. If this fails the tenant is still there to be
    // retried next run; the other order would leave public objects that no
    // row remembers, and nothing would ever come back for them.
    const objects = store ? await store.deletePrefix(keys.tenant(t.slug)) : 0;

    // One transaction per tenant, so a failure halfway through the list
    // leaves whole workspaces behind rather than half of one.
    await client.query("begin");
    try {
      // Read the members before the cascade removes the rows that name them.
      const { rows: members } = await client.query(
        `select user_id from memberships where tenant_id = $1`,
        [t.id],
      );

      // The tenant first. Its cascade takes maps, features, versions and
      // memberships; maps.created_by references users WITHOUT a cascade, so
      // deleting the user while the maps exist would be refused.
      await client.query(`delete from tenants where id = $1`, [t.id]);

      // Then the guest's user row, which belongs to no tenant and would
      // otherwise outlive it. Restricted to addresses this system minted and
      // to users with no membership left, so a real account can never match.
      await client.query(
        `delete from users u
          where u.id = any($1::uuid[])
            and u.email like '%@guest.invalid'
            and not exists (select 1 from memberships m where m.user_id = u.id)`,
        [members.map((m) => m.user_id)],
      );

      await client.query("commit");
      reaped++;
      console.log(`deleted  ${line}  ${objects} object(s)`);
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  if (!dryRun && expired.length > 0) {
    console.log(`${reaped} guest workspace(s) deleted`);
  }
} catch (err) {
  console.error(`reap failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
