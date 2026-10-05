'use strict';
/**
 * Pure decisions behind scripts/db-backup.js, kept free of I/O so they can be
 * unit-tested (src/ops/backup-plan.spec.ts): file naming, which dumps to keep,
 * whether this month's restore test is still owed, and how a restored database
 * is compared with what was recorded when the dump was taken.
 */

const NIGHTLY_KEEP = 14;
const MONTHLY_KEEP = 12;
const NAME = /^valle-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/;

const pad = (n) => String(n).padStart(2, '0');

/** valle-20261005-220003.dump, always in UTC so names sort by time. */
function dumpName(at) {
  return `valle-${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}.dump`;
}

/** The UTC time encoded in a dump's name, or null for a file that is not ours. */
function dumpTime(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "2026-10": the month a run belongs to, on the park's clock (UTC+4, no daylight saving). */
function parkMonth(at) {
  return new Date(at.getTime() + 4 * 3_600_000).toISOString().slice(0, 7);
}

/** Our dumps among `names`, newest first. */
function sortedDumps(names) {
  return names.filter((n) => dumpTime(n)).sort().reverse();
}

/**
 * Retention: the newest `keep` dumps stay, the rest go. Anything that does not
 * look like one of our dumps is left alone.
 */
function prune(names, keep) {
  const dumps = sortedDumps(names);
  return { keep: dumps.slice(0, keep), remove: dumps.slice(keep) };
}

/**
 * True when no dump of this park month has been promoted to the monthly set
 * yet: the first backup of each month is kept for a year.
 */
function needsMonthlyCopy(monthlyNames, at) {
  const month = parkMonth(at);
  return !monthlyNames.some((n) => { const t = dumpTime(n); return t && parkMonth(t) === month; });
}

/**
 * The monthly restore test is owed when no restore test has PASSED in the
 * current park month. Keyed on the month rather than the day of the month, so a
 * night missed on the 1st (deploy, outage) is caught up by the next run.
 */
function restoreTestDue(lastPassedAt, now) {
  if (!lastPassedAt) return true;
  return parkMonth(new Date(lastPassedAt)) !== parkMonth(now);
}

/**
 * Compares a restored database with the manifest written when the dump was
 * taken. The row counts in the manifest come from the same snapshot pg_dump
 * read, so they must match exactly.
 */
function compareRestore(manifest, restored) {
  const problems = [];
  const expected = manifest.tables || {};
  const got = restored.tables || {};
  for (const [table, rows] of Object.entries(expected)) {
    if (!(table in got)) problems.push(`table ${table} is missing from the restore`);
    else if (Number(got[table]) !== Number(rows)) problems.push(`table ${table}: ${got[table]} rows restored, ${rows} in the backup`);
  }
  for (const table of Object.keys(got)) {
    if (!(table in expected)) problems.push(`table ${table} was restored but is not in the manifest`);
  }
  if (Number(restored.invalidIndexes || 0) > 0) problems.push(`${restored.invalidIndexes} invalid index(es) after the restore`);
  if (Number(restored.unvalidatedConstraints || 0) > 0) problems.push(`${restored.unvalidatedConstraints} constraint(s) not validated after the restore`);
  if (manifest.latestBookingAt && restored.latestBookingAt !== manifest.latestBookingAt) {
    problems.push(`latest booking in the restore is ${restored.latestBookingAt || 'none'}, the backup recorded ${manifest.latestBookingAt}`);
  }
  const tables = Object.keys(expected).length;
  const rows = Object.values(expected).reduce((n, v) => n + Number(v), 0);
  return { ok: problems.length === 0, problems, tables, rows };
}

/** 1536 -> "1.5 kB"; used in logs, e-mails and the staff view. */
function humanBytes(bytes) {
  const units = ['B', 'kB', 'MB', 'GB'];
  let n = Number(bytes) || 0;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

module.exports = {
  NIGHTLY_KEEP, MONTHLY_KEEP, dumpName, dumpTime, parkMonth, sortedDumps, prune, needsMonthlyCopy, restoreTestDue, compareRestore, humanBytes,
};
