#!/usr/bin/env node
// Applies migrations/NNNN_*.sql in order, recording each in schema_migrations.
//
//   node scripts/migrate.mjs up      apply everything pending
//   node scripts/migrate.mjs down    reverse the newest applied migration
//   node scripts/migrate.mjs status  list applied and pending
//
// No migration framework: the whole need is "run these files once, in order",
// and a dependency that owns the schema is a liability in a project whose
// schema is the product.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "migrations");

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DB_PASSWORD = process.env.APP_DB_PASSWORD;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.");
  process.exit(1);
}

async function listMigrations() {
  const files = await readdir(MIGRATIONS);
  return files
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort();
}

async function applied(client) {
  await client.query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const { rows } = await client.query(
    "select name from schema_migrations order by name",
  );
  return rows.map((r) => r.name);
}

async function up(client) {
  const done = new Set(await applied(client));
  const pending = (await listMigrations()).filter((f) => !done.has(f));

  if (pending.length === 0) {
    console.log("nothing to apply");
    return;
  }

  for (const name of pending) {
    const sql = await readFile(join(MIGRATIONS, name), "utf8");
    process.stdout.write(`applying ${name} ... `);

    // The migration reads this GUC to set the app role's password, so the
    // credential never appears in a committed .sql file.
    await client.query("select set_config('livemap.app_password', $1, false)", [
      APP_DB_PASSWORD ?? "livemap_dev_app",
    ]);

    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [
        name,
      ]);
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      // Each migration file wraps itself in begin/commit, so a failure has
      // already rolled the file back. Stop rather than continue past it.
      throw err;
    }
  }
}

async function down(client) {
  const done = await applied(client);
  const last = done[done.length - 1];
  if (!last) {
    console.log("nothing to reverse");
    return;
  }

  const downFile = last.replace(/\.sql$/, ".down.sql");
  const sql = await readFile(join(MIGRATIONS, downFile), "utf8");
  process.stdout.write(`reversing ${last} ... `);
  await client.query(sql);
  await client.query("delete from schema_migrations where name = $1", [last]);
  console.log("ok");
}

async function status(client) {
  const done = new Set(await applied(client));
  for (const name of await listMigrations()) {
    console.log(`${done.has(name) ? "applied" : "pending"}  ${name}`);
  }
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  const cmd = process.argv[2] ?? "up";
  if (cmd === "up") await up(client);
  else if (cmd === "down") await down(client);
  else if (cmd === "status") await status(client);
  else {
    console.error(`unknown command: ${cmd}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
