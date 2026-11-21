#!/usr/bin/env node
// Mints a session token for a membership that already exists.
//
//   node --import tsx scripts/mint-token.mjs <tenant-slug> <user-email> [hours]
//
// There is no login flow, so this is how a seeded tenant gets a credential to
// paste into the sign-in page. It reads the membership rather than taking a
// role on the command line: the server resolves the role from the database on
// every request anyway, so a role typed here would be decoration at best.

import pg from "pg";
import { signSession } from "../packages/api/src/auth.ts";

const { ADMIN_DATABASE_URL, SESSION_SECRET } = process.env;
if (!ADMIN_DATABASE_URL || !SESSION_SECRET) {
  console.error("ADMIN_DATABASE_URL and SESSION_SECRET must be set");
  process.exit(1);
}

const [slug, email, hoursArg] = process.argv.slice(2);
const hours = hoursArg === undefined ? 24 : Number(hoursArg);
if (!slug || !email || !Number.isFinite(hours) || hours <= 0) {
  console.error("usage: mint-token.mjs <tenant-slug> <user-email> [hours]");
  process.exit(1);
}

const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });

try {
  await client.connect();
  const { rows } = await client.query(
    `select t.id as tenant_id, t.slug, u.id as user_id, m.role
       from memberships m
       join tenants t on t.id = m.tenant_id
       join users u   on u.id = m.user_id
      where t.slug = $1 and u.email = $2`,
    [slug, email],
  );

  if (rows.length === 0) {
    console.error(`no membership for ${email} in tenant "${slug}"`);
    process.exitCode = 1;
  } else {
    const r = rows[0];
    console.log(
      signSession(
        {
          userId: r.user_id,
          tenantId: r.tenant_id,
          tenantSlug: r.slug,
          role: r.role,
          exp: Math.floor(Date.now() / 1000) + Math.round(hours * 3600),
        },
        SESSION_SECRET,
      ),
    );
  }
} catch (err) {
  console.error(`mint failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
