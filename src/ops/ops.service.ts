import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface BackupRun {
  id: string; kind: 'backup' | 'restore_test'; ok: boolean; startedAt: string; finishedAt: string;
  file: string; bytes: number; tables: number; rows: number; detail: string;
}

export interface BackupStatus {
  /** ok: fresh backup and a restore test passed recently. warning: something is overdue. failing: the latest run failed. unknown: nothing recorded yet. */
  state: 'ok' | 'warning' | 'failing' | 'unknown';
  problems: string[];
  lastBackup: BackupRun | null;
  lastGoodBackup: BackupRun | null;
  lastRestoreTest: BackupRun | null;
  lastGoodRestoreTest: BackupRun | null;
  recent: BackupRun[];
}

/** A nightly backup older than this means a night was missed. */
export const BACKUP_MAX_AGE_HOURS = 36;
/** The restore test runs monthly; a little over a month without a pass is overdue. */
export const RESTORE_TEST_MAX_AGE_DAYS = 35;

interface Row {
  id: string; kind: 'backup' | 'restore_test'; ok: boolean; started_at: Date; finished_at: Date;
  file: string; bytes: string; table_count: number; row_count: string; detail: string;
}

const toRun = (r: Row): BackupRun => ({
  id: String(r.id), kind: r.kind, ok: r.ok, startedAt: new Date(r.started_at).toISOString(), finishedAt: new Date(r.finished_at).toISOString(),
  file: r.file, bytes: Number(r.bytes), tables: Number(r.table_count), rows: Number(r.row_count), detail: r.detail,
});

/** Pure: turns the backup log (newest first) into the verdict the back office shows. */
export function backupStatus(runs: BackupRun[], now: Date): BackupStatus {
  const newest = (kind: BackupRun['kind'], okOnly = false) => runs.find((r) => r.kind === kind && (!okOnly || r.ok)) ?? null;
  const lastBackup = newest('backup');
  const lastGoodBackup = newest('backup', true);
  const lastRestoreTest = newest('restore_test');
  const lastGoodRestoreTest = newest('restore_test', true);
  const base = { lastBackup, lastGoodBackup, lastRestoreTest, lastGoodRestoreTest };
  if (runs.length === 0) return { state: 'unknown', problems: ['No backup has been recorded yet.'], ...base, recent: [] };

  const problems: string[] = [];
  let failing = false;
  const hoursSince = (iso: string) => (now.getTime() - Date.parse(iso)) / 3_600_000;

  if (lastBackup && !lastBackup.ok) { failing = true; problems.push(`The latest nightly backup failed: ${lastBackup.detail}`); }
  if (!lastGoodBackup) { failing = true; problems.push('There is no successful backup on record.'); }
  else if (hoursSince(lastGoodBackup.finishedAt) > BACKUP_MAX_AGE_HOURS) {
    problems.push(`The last successful backup is ${Math.floor(hoursSince(lastGoodBackup.finishedAt))} hours old: at least one night was missed.`);
  }
  if (lastRestoreTest && !lastRestoreTest.ok) { failing = true; problems.push(`The latest restore test failed: ${lastRestoreTest.detail}`); }
  if (!lastGoodRestoreTest) problems.push('No restore test has passed yet.');
  else if (hoursSince(lastGoodRestoreTest.finishedAt) > RESTORE_TEST_MAX_AGE_DAYS * 24) {
    problems.push(`The last passed restore test is ${Math.floor(hoursSince(lastGoodRestoreTest.finishedAt) / 24)} days old: the monthly test is overdue.`);
  }
  const state: BackupStatus['state'] = failing ? 'failing' : problems.length ? 'warning' : 'ok';
  return { state, problems, ...base, recent: runs.slice(0, 20) };
}

@Injectable()
export class OpsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** The backup log, newest first, judged against the nightly and monthly expectations. */
  async backups(now = new Date()): Promise<BackupStatus> {
    const rows: Row[] = await this.db.query(
      `SELECT id, kind, ok, started_at, finished_at, file, bytes, table_count, row_count, detail
         FROM backup_runs ORDER BY finished_at DESC, id DESC LIMIT 120`,
    );
    return backupStatus(rows.map(toRun), now);
  }
}
