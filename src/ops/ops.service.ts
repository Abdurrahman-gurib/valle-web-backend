import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { parseCalendar, parseSessions, type Calendar } from '../bookings/capacity';
import { Experience, Setting } from '../entities';
import type { CalendarDto } from './calendar.dto';

export interface CalendarView extends Calendar {
  /** Where the slot capacity comes from when no setting is stored. */
  slotCapacitySource: 'setting' | 'default';
  experiences: { id: string; name: string; priceMode: string }[];
}

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
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
    @InjectRepository(Experience) private readonly experienceRepo: Repository<Experience>,
  ) {}

  // ------------------------------------------------------------- calendar

  async calendar(): Promise<CalendarView> {
    const [settings, experiences] = await Promise.all([this.settingRepo.find(), this.experienceRepo.find({ order: { sortOrder: 'ASC' } })]);
    const map = new Map(settings.map((x) => [x.key, x.value]));
    const env = Number(process.env.BOOKING_SLOT_CAPACITY ?? '');
    const cal = parseCalendar(map, Number.isFinite(env) && env > 0 ? env : undefined);
    return {
      ...cal,
      slotCapacitySource: map.has('slot_capacity') ? 'setting' : 'default',
      experiences: experiences.filter((e) => e.priceMode === 'pp' || e.priceMode === 'flat').map((e) => ({ id: e.id, name: e.name, priceMode: e.priceMode })),
    };
  }

  /** Stored as the settings rows the booking path reads; parsed back so the UI shows what applies. */
  async saveCalendar(dto: CalendarDto): Promise<CalendarView> {
    const closures = dto.closures.map((c) => ({ from: c.from, to: c.to >= c.from ? c.to : c.from, slot: c.slot, kind: c.kind, reason: (c.reason ?? '').trim() }));
    const capacity: Record<string, { morning: number | null; afternoon: number | null }> = {};
    for (const [id, v] of Object.entries(dto.activityCapacity ?? {})) {
      const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : null);
      const m = n(v?.morning), a = n(v?.afternoon);
      if (m !== null || a !== null) capacity[id] = { morning: m, afternoon: a };
    }
    const rows: Setting[] = [
      Object.assign(new Setting(), { key: 'closures', value: JSON.stringify(closures) }),
      Object.assign(new Setting(), { key: 'activity_capacity', value: JSON.stringify(capacity) }),
    ];
    if (dto.slotCapacity) rows.push(Object.assign(new Setting(), { key: 'slot_capacity', value: String(dto.slotCapacity) }));
    if (dto.sessions !== undefined) rows.push(Object.assign(new Setting(), { key: 'activity_sessions', value: JSON.stringify(parseSessions(JSON.stringify(dto.sessions))) }));
    await this.settingRepo.save(rows);
    return this.calendar();
  }

  /** The backup log, newest first, judged against the nightly and monthly expectations. */
  async backups(now = new Date()): Promise<BackupStatus> {
    const rows: Row[] = await this.db.query(
      `SELECT id, kind, ok, started_at, finished_at, file, bytes, table_count, row_count, detail
         FROM backup_runs ORDER BY finished_at DESC, id DESC LIMIT 120`,
    );
    return backupStatus(rows.map(toRun), now);
  }
}
