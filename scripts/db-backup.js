#!/usr/bin/env node
'use strict';
/**
 * Nightly database backup and monthly restore test.
 *
 * Runs in the `db-backup` cron service (Dockerfile.backup, see
 * .railway/railway.ts) every night at 02:00 park time:
 *
 *   1. BACKUP   pg_dump (custom format) of the production database into
 *               $BACKUP_DIR/nightly, from an exported snapshot. Row counts per
 *               table are taken in that same snapshot and written to a manifest
 *               next to the dump together with its size and SHA-256.
 *   2. RETAIN   the newest 14 nightly dumps; the first dump of each month is
 *               also copied to $BACKUP_DIR/monthly and kept for 12 months.
 *   3. RESTORE  once a month (the first run of the month that has no passed
 *      TEST     test yet), the newest dump is restored into a throwaway
 *               PostgreSQL started inside this container, never into
 *               production, and compared with its manifest: every table
 *               present, every row count equal, no invalid index, same latest
 *               booking. The scratch server is deleted afterwards.
 *
 * Every run is recorded in backup_runs (the back office shows it), reported to
 * Sentry Crons when SENTRY_DSN is set, and e-mailed to BACKUP_NOTIFY_TO: always
 * on failure, and once a month with the restore-test result.
 *
 *   node scripts/db-backup.js                  the nightly run
 *   node scripts/db-backup.js --restore-test   back up, then test the restore now
 *   node scripts/db-backup.js --test-only      test the newest existing dump
 *   node scripts/db-backup.js --list           what is stored
 *
 * Exits non-zero when the backup or a due restore test fails.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { clientConfig, connect, describe } = require('./lib/db');
const plan = require('./lib/backup-plan');

const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const NIGHTLY = path.join(BACKUP_DIR, 'nightly');
const MONTHLY = path.join(BACKUP_DIR, 'monthly');
const MIGRATION = path.join(__dirname, '..', 'database', 'migrations', '009-backup-runs.sql');
/** Unprivileged account the scratch server runs as when this script is root (PostgreSQL refuses to run as root). */
const PG_OS_USER = process.env.BACKUP_PG_OS_USER || 'postgres';
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const args = process.argv.slice(2);
const known = ['--restore-test', '--test-only', '--list'];
if (args.some((a) => !known.includes(a))) {
  console.error(`db-backup: unknown option ${args.filter((a) => !known.includes(a)).join(', ')}`);
  console.error('Usage: node scripts/db-backup.js [--restore-test | --test-only | --list]');
  process.exit(2);
}

const log = (msg) => console.log(`[db-backup] ${msg}`);

/** Runs a program to completion; rejects with its stderr when it exits non-zero. */
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const asUser = opts.asPostgres && IS_ROOT;
    const child = spawn(asUser ? 'su-exec' : cmd, asUser ? [PG_OS_USER, cmd, ...cmdArgs] : cmdArgs, {
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${(err || out).trim().split('\n').slice(-6).join(' | ')}`));
    });
  });
}

/** libpq environment for pg_dump against the same database the API uses. */
function libpqEnv() {
  const cfg = clientConfig();
  if (cfg.connectionString) {
    const u = new URL(cfg.connectionString);
    return {
      PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: u.pathname.slice(1), PGSSLMODE: cfg.ssl ? 'require' : 'prefer',
    };
  }
  return {
    PGHOST: cfg.host, PGPORT: String(cfg.port), PGUSER: cfg.user, PGPASSWORD: cfg.password, PGDATABASE: cfg.database,
    PGSSLMODE: cfg.ssl ? 'require' : 'disable',
  };
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

const quote = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

/** Row count of every table in `public`, plus the newest booking, on an open client. */
async function inventory(client) {
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const tables = {};
  for (const { tablename } of rows) {
    const r = await client.query(`SELECT count(*)::bigint AS n FROM public.${quote(tablename)}`);
    tables[tablename] = Number(r.rows[0].n);
  }
  let latestBookingAt = null;
  if ('bookings' in tables) {
    const r = await client.query('SELECT max(created_at) AS at FROM public.bookings');
    latestBookingAt = r.rows[0].at ? new Date(r.rows[0].at).toISOString() : null;
  }
  return { tables, latestBookingAt };
}

async function record(run) {
  let client;
  try {
    client = await connect();
    await client.query(fs.readFileSync(MIGRATION, 'utf8')); // idempotent; the API deploy applies it too
    await client.query(
      `INSERT INTO backup_runs (kind, ok, started_at, file, bytes, sha256, table_count, row_count, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [run.kind, run.ok, run.startedAt, run.file || '', run.bytes || 0, run.sha256 || '', run.tables || 0, run.rows || 0, (run.detail || '').slice(0, 4000)],
    );
  } catch (e) {
    log(`could not record the run in backup_runs: ${e.message}`);
  } finally {
    if (client) await client.end().catch(() => undefined);
  }
}

async function lastPassedRestoreTest() {
  let client;
  try {
    client = await connect();
    const r = await client.query("SELECT max(finished_at) AS at FROM backup_runs WHERE kind = 'restore_test' AND ok");
    return r.rows[0].at || null;
  } catch {
    return null; // table not there yet: the test is due
  } finally {
    if (client) await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- backup

async function backup() {
  const startedAt = new Date();
  fs.mkdirSync(NIGHTLY, { recursive: true });
  fs.mkdirSync(MONTHLY, { recursive: true });
  const name = plan.dumpName(startedAt);
  const file = path.join(NIGHTLY, name);
  log(`backing up ${describe(clientConfig())} to ${file}`);

  // Counts and dump read the SAME snapshot, so the manifest is exact.
  const snap = await connect();
  let manifest;
  try {
    await snap.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await snap.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const server = (await snap.query('SHOW server_version')).rows[0].server_version;
    const inv = await inventory(snap);
    await run('pg_dump', ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', `--snapshot=${snapshot}`, `--file=${file}`], { env: libpqEnv() });
    manifest = { file: name, createdAt: startedAt.toISOString(), serverVersion: server, ...inv };
  } finally {
    await snap.query('ROLLBACK').catch(() => undefined);
    await snap.end().catch(() => undefined);
  }

  // The archive must at least be readable end to end before it counts as a backup.
  const toc = await run('pg_restore', ['--list', file]);
  const entries = toc.split('\n').filter((l) => l && !l.startsWith(';')).length;
  if (entries === 0) throw new Error('pg_restore --list found nothing in the dump');

  manifest.bytes = fs.statSync(file).size;
  manifest.sha256 = await sha256(file);
  manifest.tocEntries = entries;
  fs.writeFileSync(`${file}.json`, JSON.stringify(manifest, null, 1));

  if (plan.needsMonthlyCopy(fs.readdirSync(MONTHLY), startedAt)) {
    fs.copyFileSync(file, path.join(MONTHLY, name));
    fs.copyFileSync(`${file}.json`, path.join(MONTHLY, `${name}.json`));
    log(`kept as this month's long-term copy: monthly/${name}`);
  }
  for (const [dir, keep] of [[NIGHTLY, plan.NIGHTLY_KEEP], [MONTHLY, plan.MONTHLY_KEEP]]) {
    for (const old of plan.prune(fs.readdirSync(dir), keep).remove) {
      fs.rmSync(path.join(dir, old), { force: true });
      fs.rmSync(path.join(dir, `${old}.json`), { force: true });
      log(`retention: removed ${path.basename(dir)}/${old}`);
    }
  }

  const tables = Object.keys(manifest.tables).length;
  const rows = Object.values(manifest.tables).reduce((n, v) => n + v, 0);
  log(`backup ok: ${plan.humanBytes(manifest.bytes)}, ${tables} tables, ${rows} rows, sha256 ${manifest.sha256.slice(0, 12)}…`);
  return { kind: 'backup', ok: true, startedAt, file: name, bytes: manifest.bytes, sha256: manifest.sha256, tables, rows, detail: `PostgreSQL ${manifest.serverVersion}, ${entries} archive entries` };
}

// ---------------------------------------------------------------- restore test

/** Restores the newest dump into a scratch PostgreSQL inside this container and checks it against its manifest. */
async function restoreTest() {
  const startedAt = new Date();
  const newest = fs.existsSync(NIGHTLY) ? plan.sortedDumps(fs.readdirSync(NIGHTLY))[0] : undefined;
  if (!newest) throw new Error(`no dump found in ${NIGHTLY}`);
  const file = path.join(NIGHTLY, newest);
  const manifest = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
  log(`restore test of ${newest} (taken ${manifest.createdAt})`);

  // from here on a failure is about this file: say which one in the log row
  const fail = (e) => Object.assign(e instanceof Error ? e : new Error(String(e)), { file: newest });
  const actual = await sha256(file);
  if (actual !== manifest.sha256) throw fail(new Error(`checksum mismatch on ${newest}: the stored file is not the one that was written`));

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'valle-restore-'));
  const data = path.join(work, 'data');
  const sock = path.join(work, 'sock');
  fs.mkdirSync(sock);
  if (IS_ROOT) await run('chown', ['-R', `${PG_OS_USER}:${PG_OS_USER}`, work]);
  // The scratch server only listens on a unix socket in the temp directory: nothing can reach it from outside.
  const local = { PGHOST: sock, PGPORT: '54329', PGUSER: PG_OS_USER, PGDATABASE: 'postgres', PGPASSWORD: '', PGSSLMODE: 'disable' };
  let started = false;
  try {
    await run('initdb', ['-D', data, '-U', PG_OS_USER, '--auth=trust', '--encoding=UTF8', '--locale=C'], { asPostgres: true });
    await run('pg_ctl', ['-D', data, '-w', '-t', '60', '-o', `-c listen_addresses='' -c unix_socket_directories='${sock}' -c port=54329 -c fsync=off`, '-l', path.join(work, 'server.log'), 'start'], { asPostgres: true });
    started = true;
    await run('createdb', ['restore_check'], { env: local, asPostgres: true });
    await run('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname=restore_check', file], { env: local, asPostgres: true });

    const client = new Client({ host: sock, port: 54329, user: PG_OS_USER, database: 'restore_check' });
    let restored;
    try {
      await client.connect();
      restored = await inventory(client);
      restored.invalidIndexes = Number((await client.query('SELECT count(*)::int AS n FROM pg_index WHERE NOT indisvalid')).rows[0].n);
      restored.unvalidatedConstraints = Number((await client.query('SELECT count(*)::int AS n FROM pg_constraint WHERE NOT convalidated')).rows[0].n);
    } finally {
      await client.end().catch(() => undefined);
    }

    const verdict = plan.compareRestore(manifest, restored);
    const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
    if (!verdict.ok) throw new Error(`restore does not match the backup: ${verdict.problems.slice(0, 8).join('; ')}`);
    log(`restore test passed in ${seconds}s: ${verdict.tables} tables, ${verdict.rows} rows identical to the backup`);
    return { kind: 'restore_test', ok: true, startedAt, file: newest, bytes: manifest.bytes, sha256: manifest.sha256, tables: verdict.tables, rows: verdict.rows, detail: `Restored into a scratch PostgreSQL in ${seconds}s; every table and row count matches the backup taken ${manifest.createdAt}.` };
  } catch (e) {
    throw fail(e);
  } finally {
    if (started) await run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { asPostgres: true }).catch((e) => log(`could not stop the scratch server: ${e.message}`));
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- reporting

/** Sentry Crons check-in over plain HTTPS (no SDK in this image). Creates or updates the monitor as it reports. */
async function sentryCheckIn(slug, ok, schedule) {
  const dsn = (process.env.SENTRY_DSN || '').trim();
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/\//g, '');
    const body = {
      status: ok ? 'ok' : 'error',
      environment: process.env.SENTRY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || 'production',
      monitor_config: { schedule: { type: 'crontab', value: schedule }, checkin_margin: 120, max_runtime: 30, timezone: 'UTC', failure_issue_threshold: 1, recovery_threshold: 1 },
    };
    const res = await fetch(`${u.protocol}//${u.host}/api/${projectId}/cron/${slug}/${u.username}/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`Sentry check-in for ${slug} answered ${res.status}`);
  } catch (e) {
    log(`Sentry check-in for ${slug} failed: ${e.message}`);
  }
}

async function notify(subject, lines) {
  const to = (process.env.BACKUP_NOTIFY_TO || '').trim();
  const smtp = (process.env.SMTP_URL || '').trim();
  if (!to || !smtp) { log(`no e-mail sent (${!to ? 'BACKUP_NOTIFY_TO' : 'SMTP_URL'} is not set): ${subject}`); return; }
  try {
    const nodemailer = require('nodemailer');
    await nodemailer.createTransport(smtp).sendMail({
      from: process.env.MAIL_FROM || 'VALLÉ Advenature Park <bookings@vallepark.com>', to, subject, text: lines.join('\n'),
    });
    log(`e-mailed ${to}: ${subject}`);
  } catch (e) {
    log(`could not e-mail ${to}: ${e.message}`);
  }
}

function list() {
  for (const dir of [NIGHTLY, MONTHLY]) {
    console.log(`${dir}:`);
    const dumps = fs.existsSync(dir) ? plan.sortedDumps(fs.readdirSync(dir)) : [];
    if (dumps.length === 0) console.log('  (empty)');
    for (const d of dumps) console.log(`  ${d}  ${plan.humanBytes(fs.statSync(path.join(dir, d)).size)}`);
  }
}

async function main() {
  if (args.includes('--list')) { list(); return 0; }
  let failed = false;
  const summary = [];

  if (!args.includes('--test-only')) {
    let result;
    try {
      result = await backup();
    } catch (e) {
      result = { kind: 'backup', ok: false, startedAt: new Date(), detail: e.message };
      console.error(`[db-backup] BACKUP FAILED: ${e.message}`);
    }
    await record(result);
    await sentryCheckIn('valle-db-backup', result.ok, process.env.BACKUP_CRON || '0 22 * * *');
    if (!result.ok) {
      failed = true;
      await notify('VALLÉ database backup FAILED', ['The nightly database backup did not complete.', '', result.detail, '', 'Until it is fixed there is no fresh backup. See Backend/DEPLOYMENT.md, "Backups".']);
    } else {
      summary.push(`Backup: ${result.file}, ${plan.humanBytes(result.bytes)}, ${result.tables} tables, ${result.rows} rows.`);
    }
  }

  const due = args.includes('--restore-test') || args.includes('--test-only') || plan.restoreTestDue(await lastPassedRestoreTest(), new Date());
  if (due && !failed) {
    let result;
    try {
      result = await restoreTest();
    } catch (e) {
      result = { kind: 'restore_test', ok: false, startedAt: new Date(), file: e.file || '', detail: e.message };
      console.error(`[db-backup] RESTORE TEST FAILED: ${e.message}`);
    }
    await record(result);
    await sentryCheckIn('valle-db-restore-test', result.ok, '0 22 1 * *');
    if (result.ok) {
      await notify(`VALLÉ backup check passed (${plan.parkMonth(new Date())})`, ['This month\'s test restore of the nightly database backup passed.', '', ...summary, `Restore test: ${result.detail}`, '', 'Nothing to do. This message is sent once a month.']);
    } else {
      failed = true;
      await notify('VALLÉ backup check FAILED: the backup could not be restored', ['This month\'s test restore of the nightly database backup FAILED.', '', result.detail, '', 'The backups cannot be trusted until this is fixed. See Backend/DEPLOYMENT.md, "Backups".']);
    }
  } else if (!due) {
    log('restore test not due: one has already passed this month');
  }
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(`[db-backup] ${e.stack || e.message}`); process.exit(1); });
