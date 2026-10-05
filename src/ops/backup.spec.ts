import { BackupRun, backupStatus } from './ops.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plan = require('../../scripts/lib/backup-plan.js');

const at = (iso: string) => new Date(iso);

describe('backup plan (scripts/lib/backup-plan.js)', () => {
  it('names dumps by UTC time and reads the time back', () => {
    const name = plan.dumpName(at('2026-10-05T22:00:03Z'));
    expect(name).toBe('valle-20261005-220003.dump');
    expect(plan.dumpTime(name).toISOString()).toBe('2026-10-05T22:00:03.000Z');
    expect(plan.dumpTime('notes.txt')).toBeNull();
    expect(plan.dumpTime('valle-20261005-220003.dump.json')).toBeNull();
  });

  it('keeps the newest dumps and never touches files that are not dumps', () => {
    const names = ['valle-20261001-220000.dump', 'valle-20261003-220000.dump', 'valle-20261002-220000.dump', 'README', 'valle-20261003-220000.dump.json'];
    expect(plan.prune(names, 2)).toEqual({
      keep: ['valle-20261003-220000.dump', 'valle-20261002-220000.dump'],
      remove: ['valle-20261001-220000.dump'],
    });
    expect(plan.prune(names, 14).remove).toEqual([]);
  });

  it('counts months on the park clock (UTC+4): 22:00 UTC on the 31st is already the 1st', () => {
    expect(plan.parkMonth(at('2026-10-31T19:59:00Z'))).toBe('2026-10');
    expect(plan.parkMonth(at('2026-10-31T22:00:00Z'))).toBe('2026-11');
  });

  it('promotes the first dump of each park month to the monthly set, once', () => {
    expect(plan.needsMonthlyCopy([], at('2026-11-01T22:00:00Z'))).toBe(true);
    // 31 Oct 22:00 UTC is already November at the park
    expect(plan.needsMonthlyCopy(['valle-20261031-220000.dump'], at('2026-11-01T22:00:00Z'))).toBe(false);
    expect(plan.needsMonthlyCopy(['valle-20261030-220000.dump'], at('2026-11-01T22:00:00Z'))).toBe(true);
  });

  it('owes a restore test until one has passed in the current month, so a missed 1st is caught up', () => {
    expect(plan.restoreTestDue(null, at('2026-10-05T22:00:00Z'))).toBe(true);
    // 30 Sep 23:00 UTC is already October at the park
    expect(plan.restoreTestDue('2026-09-30T23:00:00Z', at('2026-10-05T22:00:00Z'))).toBe(false);
    expect(plan.restoreTestDue('2026-09-12T22:00:00Z', at('2026-10-05T22:00:00Z'))).toBe(true);
    expect(plan.restoreTestDue('2026-10-01T22:00:00Z', at('2026-10-20T22:00:00Z'))).toBe(false);
  });

  it('passes a restore only when every table and row count matches the manifest', () => {
    const manifest = { tables: { bookings: 12, booking_lines: 30 }, latestBookingAt: '2026-10-05T08:00:00.000Z' };
    const good = { tables: { bookings: 12, booking_lines: 30 }, latestBookingAt: '2026-10-05T08:00:00.000Z', invalidIndexes: 0, unvalidatedConstraints: 0 };
    expect(plan.compareRestore(manifest, good)).toEqual({ ok: true, problems: [], tables: 2, rows: 42 });

    const short = plan.compareRestore(manifest, { ...good, tables: { bookings: 11, booking_lines: 30 } });
    expect(short.ok).toBe(false);
    expect(short.problems[0]).toContain('bookings: 11 rows restored, 12 in the backup');

    expect(plan.compareRestore(manifest, { ...good, tables: { bookings: 12 } }).problems[0]).toContain('booking_lines is missing');
    expect(plan.compareRestore(manifest, { ...good, invalidIndexes: 1 }).ok).toBe(false);
    expect(plan.compareRestore(manifest, { ...good, latestBookingAt: '2026-10-04T08:00:00.000Z' }).ok).toBe(false);
    expect(plan.compareRestore(manifest, { ...good, tables: { ...good.tables, stray: 1 } }).ok).toBe(false);
  });

  it('formats sizes for people', () => {
    expect(plan.humanBytes(512)).toBe('512 B');
    expect(plan.humanBytes(1536)).toBe('1.5 kB');
    expect(plan.humanBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});

describe('backupStatus (what the back office shows)', () => {
  const run = (over: Partial<BackupRun>): BackupRun => ({
    id: '1', kind: 'backup', ok: true, startedAt: '2026-10-05T22:00:00.000Z', finishedAt: '2026-10-05T22:00:05.000Z',
    file: 'valle-20261005-220000.dump', bytes: 1000, tables: 37, rows: 400, detail: '', ...over,
  });
  const now = at('2026-10-06T06:00:00Z');

  it('is unknown before the first run', () => {
    expect(backupStatus([], now).state).toBe('unknown');
  });

  it('is ok with the backup of last night and a restore test passed this month', () => {
    const s = backupStatus([run({}), run({ id: '2', kind: 'restore_test', finishedAt: '2026-10-01T22:01:00.000Z' })], now);
    expect(s.state).toBe('ok');
    expect(s.problems).toEqual([]);
    expect(s.lastGoodBackup?.file).toBe('valle-20261005-220000.dump');
  });

  it('warns when a night was missed or the monthly test is overdue', () => {
    const stale = backupStatus([run({ finishedAt: '2026-10-03T22:00:05.000Z' }), run({ id: '2', kind: 'restore_test', finishedAt: '2026-10-01T22:01:00.000Z' })], now);
    expect(stale.state).toBe('warning');
    expect(stale.problems[0]).toContain('at least one night was missed');

    const overdue = backupStatus([run({}), run({ id: '2', kind: 'restore_test', finishedAt: '2026-08-20T22:01:00.000Z' })], now);
    expect(overdue.state).toBe('warning');
    expect(overdue.problems[0]).toContain('monthly test is overdue');

    expect(backupStatus([run({})], now).problems).toEqual(['No restore test has passed yet.']);
  });

  it('is failing when the latest backup or the latest restore test failed', () => {
    const failed = backupStatus([run({ ok: false, detail: 'pg_dump exited 1' }), run({ id: '0', finishedAt: '2026-10-04T22:00:05.000Z' })], now);
    expect(failed.state).toBe('failing');
    expect(failed.problems[0]).toContain('pg_dump exited 1');

    const badRestore = backupStatus([
      run({}),
      run({ id: '2', kind: 'restore_test', ok: false, detail: 'checksum mismatch' }),
      run({ id: '3', kind: 'restore_test', finishedAt: '2026-09-01T22:00:00.000Z' }),
    ], now);
    expect(badRestore.state).toBe('failing');
    expect(badRestore.problems.join(' ')).toContain('checksum mismatch');
  });
});
