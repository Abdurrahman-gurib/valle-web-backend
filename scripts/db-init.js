#!/usr/bin/env node
'use strict';
/**
 * Database bootstrap. Applies database/schema.sql and database/seed.sql to the
 * database named by DB_* (or DATABASE_URL). Idempotent, which is what lets it
 * run as the Railway pre-deploy command before EVERY deployment:
 *
 *   empty database             schema + seed        (first deploy)
 *   schema but no content      seed                 (an earlier seed did not finish)
 *   already initialised        nothing              (every later deploy)
 *
 * Options. Both are DESTRUCTIVE and refuse to run without their confirmation
 * variable:
 *
 *   --reseed  (CONFIRM_RESEED=yes)
 *       Re-applies seed.sql. Its TRUNCATE ... CASCADE empties every table that
 *       references the content or the staff accounts, so this deletes ALL
 *       bookings, booking lines, audit rows, chat conversations and messages,
 *       and job applications; only quote requests survive. It also restores the
 *       published starter staff passwords: rotate them again afterwards with
 *       scripts/staff-password.js.
 *
 *   --reset   (CONFIRM_RESET=yes)
 *       Drops every table and rebuilds from schema + seed.
 *
 * Exits non-zero on any failure, so a broken bootstrap fails the deploy rather
 * than starting an API against a half-built schema.
 *
 * Schema CHANGES: schema.sql starts with DROP TABLE, so it is only ever applied
 * to an empty database. Later changes ship as database/migrations/NNN-*.sql,
 * every one idempotent (IF NOT EXISTS ...); they are applied in name order on
 * every run, after the schema/seed step.
 */
const fs = require('node:fs');
const path = require('node:path');
const { clientConfig, connect, describe } = require('./lib/db');

const DB_DIR = path.join(__dirname, '..', 'database');
const SCHEMA = path.join(DB_DIR, 'schema.sql');
const SEED = path.join(DB_DIR, 'seed.sql');
const MIGRATIONS = path.join(DB_DIR, 'migrations');

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--reseed' && a !== '--reset');
if (unknown.length) {
  console.error(`db-init: unknown option ${unknown.join(', ')}`);
  console.error('Usage: node scripts/db-init.js [--reseed | --reset]');
  process.exit(2);
}
const reseed = args.includes('--reseed');
const reset = args.includes('--reset');

async function apply(client, file) {
  const sql = fs.readFileSync(file, 'utf8');
  console.log(`[db-init] applying ${path.basename(file)}`);
  await client.query(sql);
}

async function main() {
  if (reset && process.env.CONFIRM_RESET !== 'yes') {
    throw new Error('--reset drops every table, bookings included; set CONFIRM_RESET=yes to confirm.');
  }
  if (reseed && process.env.CONFIRM_RESEED !== 'yes') {
    throw new Error(
      '--reseed deletes every booking, chat and job application (the seed truncates with ' +
        'CASCADE) and restores the starter staff passwords; set CONFIRM_RESEED=yes to confirm.',
    );
  }
  for (const f of [SCHEMA, SEED]) {
    if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
  }

  const client = await connect();
  try {
    console.log(`[db-init] connected to ${describe(clientConfig())}`);
    const probe = await client.query(
      "SELECT to_regclass('public.categories') IS NOT NULL AS has_schema",
    );
    const hasSchema = probe.rows[0].has_schema === true;
    let content = 0;
    let bookings = 0;
    if (hasSchema) {
      const { rows } = await client.query(
        'SELECT (SELECT count(*) FROM categories)::int AS content, ' +
          '(SELECT count(*) FROM bookings)::int AS bookings',
      );
      content = rows[0].content;
      bookings = rows[0].bookings;
    }

    if (reset) {
      console.log('[db-init] --reset: dropping and recreating every table');
      await apply(client, SCHEMA);
      await apply(client, SEED);
    } else if (!hasSchema) {
      console.log('[db-init] empty database: creating the schema and loading seed content');
      await apply(client, SCHEMA);
      await apply(client, SEED);
    } else if (reseed) {
      console.log(`[db-init] --reseed: replacing content, staff logins and, via cascades, ${bookings} booking(s)`);
      await apply(client, SEED);
    } else if (content === 0) {
      if (bookings > 0) {
        throw new Error(
          `schema present without content but ${bookings} booking(s) exist; refusing to guess. ` +
            'Run --reseed with CONFIRM_RESEED=yes if replacing the content is intended.',
        );
      }
      console.log('[db-init] schema present but no content (an earlier seed did not finish): loading seed content');
      await apply(client, SEED);
    } else {
      console.log('[db-init] schema and content already present, nothing to do');
    }

    if (fs.existsSync(MIGRATIONS)) {
      const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
      for (const f of files) await apply(client, path.join(MIGRATIONS, f));
    }

    const { rows } = await client.query(
      'SELECT (SELECT count(*) FROM experiences) AS experiences, ' +
        '(SELECT count(*) FROM staff_users) AS staff_users, ' +
        '(SELECT count(*) FROM bookings) AS bookings',
    );
    const c = rows[0];
    console.log(
      `[db-init] ok: experiences=${c.experiences} staff_users=${c.staff_users} bookings=${c.bookings}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[db-init] failed: ${err.message}`);
  process.exit(1);
});
