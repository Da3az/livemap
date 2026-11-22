#!/usr/bin/env node
// Creates (or reuses) a local development workspace with one member in each
// role, and prints a session token for each. For a local database only: it
// connects with the platform role, which crosses tenants.
//
//   npm run dev-workspace            # tokens valid for 24 hours
//   npm run dev-workspace -- 72      # or another number of hours
//
// Needs ADMIN_DATABASE_URL (or DATABASE_URL, the migrator) and SESSION_SECRET.
import pg from "pg";
import { signSession } from "../packages/api/src/auth.ts";

const url = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const secret = process.env.SESSION_SECRET;
if (!url || !secret) {
  console.error("ADMIN_DATABASE_URL (or DATABASE_URL) and SESSION_SECRET must be set");
  process.exit(1);
}
const hours = Number(process.argv[2] ?? 24);
if (!Number.isFinite(hours) || hours <= 0) {
  console.error("usage: dev-workspace.mjs [hours]");
  process.exit(1);
}

const TENANT = { slug: "al-mashriq", name: "Al Mashriq Newsroom" };
const PEOPLE = [
  { role: "owner", name: "Layla Haddad", email: "layla@al-mashriq.test" },
  { role: "admin", name: "Sarah Whitfield", email: "sarah@al-mashriq.test" },
  { role: "editor", name: "عمر الفارسي", email: "omar@al-mashriq.test" },
  { role: "contributor", name: "يوسف بن عمر", email: "yousef@al-mashriq.test" },
  { role: "viewer", name: "Hannah Lindqvist", email: "hannah@al-mashriq.test" },
];

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query("begin");
  const tenant = await client.query(
    `insert into tenants (slug, name) values ($1, $2)
     on conflict (slug) do update set name = excluded.name
     returning id`,
    [TENANT.slug, TENANT.name],
  );
  const tenantId = tenant.rows[0].id;
  const exp = Math.floor(Date.now() / 1000) + Math.round(hours * 3600);
  const out = [];
  for (const person of PEOPLE) {
    const user = await client.query(
      `insert into users (email, name) values ($1, $2)
       on conflict (email) do update set name = excluded.name
       returning id`,
      [person.email, person.name],
    );
    const userId = user.rows[0].id;
    await client.query(
      `insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)
       on conflict (tenant_id, user_id) do update set role = excluded.role`,
      [tenantId, userId, person.role],
    );
    out.push({ ...person, token: signSession({ userId, tenantId, tenantSlug: TENANT.slug, role: person.role, exp }, secret) });
  }
  await client.query("commit");
  for (const person of out) console.log(`${person.role.padEnd(12)} ${person.name}\n  ${person.token}`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
