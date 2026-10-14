import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cutoffs, minusMonths, parkDateCutoff, parsePolicy, policyProblems, RETENTION_DEFAULTS } from './retention.policy';
import { RETENTION_BATCH, RetentionService, RULES } from './retention.service';

const at = (iso: string) => new Date(iso);

describe('retention cut-offs', () => {
  it('subtracts calendar months and clamps to the month end', () => {
    expect(minusMonths(at('2026-10-14T10:00:00Z'), 12).toISOString()).toBe('2025-10-14T10:00:00.000Z');
    expect(minusMonths(at('2026-03-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(minusMonths(at('2028-03-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(minusMonths(at('2026-01-15T00:00:00Z'), 24).toISOString()).toBe('2024-01-15T00:00:00.000Z');
  });

  it('counts visit dates on the park clock (UTC+4)', () => {
    // 21:00 UTC on 14 Oct is already 15 Oct in Mauritius
    expect(parkDateCutoff(at('2026-10-14T21:00:00Z'), 12)).toBe('2025-10-15');
    expect(parkDateCutoff(at('2026-10-14T19:00:00Z'), 12)).toBe('2025-10-14');
  });

  it('derives every cut-off from the default policy', () => {
    const now = at('2026-10-14T08:00:00Z');
    const c = cutoffs(RETENTION_DEFAULTS, now);
    expect(c.chatBefore.toISOString()).toBe('2025-10-14T08:00:00.000Z');
    expect(c.quoteBefore.toISOString()).toBe('2024-10-14T08:00:00.000Z');
    expect(c.applicationBefore.toISOString()).toBe('2025-10-14T08:00:00.000Z');
    expect(c.tableReservationBefore).toBe('2024-10-14');
    expect(c.photoVisitBefore).toBe('2025-10-14');
    expect(c.bookingVisitBefore).toBe('2019-10-14');
    expect(c.expiredBefore).toBe(now);
  });

  it('falls back to defaults for missing, broken or out-of-bounds settings', () => {
    expect(parsePolicy(undefined)).toEqual(RETENTION_DEFAULTS);
    expect(parsePolicy('not json')).toEqual(RETENTION_DEFAULTS);
    const p = parsePolicy(JSON.stringify({ chatMonths: 6, bookingYears: 2, quoteMonths: 3.5 }));
    expect(p.chatMonths).toBe(6);
    expect(p.bookingYears).toBe(7); // below the accounting floor
    expect(p.quoteMonths).toBe(24);
  });

  it('rejects edits outside the safe bounds', () => {
    expect(policyProblems({ chatMonths: 18 })).toEqual([]);
    expect(policyProblems({ bookingYears: 5 })[0]).toMatch(/bookingYears/);
    expect(policyProblems({ photoMonths: 0 })[0]).toMatch(/photoMonths/);
  });
});

function makeService(opts: { setting?: string; counts?: Record<string, number> } = {}) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    const m = /FROM (\w+) t WHERE/.exec(sql);
    if (sql.startsWith('SELECT count(*)') && m) return [{ n: opts.counts?.[m[1]] ?? 0 }];
    return [];
  });
  const db = { query, transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn({ query })) };
  const settingRepo = {
    findOne: jest.fn(async () => (opts.setting ? { key: 'retention', value: opts.setting } : null)),
    save: jest.fn(async (x: unknown) => x),
  };
  const config = { get: () => undefined } as unknown as ConfigService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new RetentionService(db as any, settingRepo as any, config);
  return { svc, db, settingRepo, queries };
}

describe('RetentionService dry run', () => {
  it('counts every category without deleting or updating anything', async () => {
    const { svc, db, queries } = makeService({
      counts: { chat_conversations: 4, quotes: 2, table_reservations: 1, job_applications: 3, booking_photos: 9, booking_drafts: 5, slot_holds: 7, bookings: 11 },
    });
    const r = await svc.preview(at('2026-10-14T08:00:00Z'));
    expect(r.counts).toEqual({
      chatConversations: 4, quotes: 2, tableReservations: 1, jobApplications: 3,
      bookingPhotos: 9, bookingDrafts: 5, slotHolds: 7, bookingsAnonymised: 11,
    });
    expect(queries.every((q) => /^SELECT count/.test(q.sql))).toBe(true);
    expect(db.transaction).not.toHaveBeenCalled();
    // the cut-offs are passed as parameters, never interpolated
    const chat = queries.find((q) => q.sql.includes('chat_conversations'))!;
    expect((chat.params![0] as Date).toISOString()).toBe('2025-10-14T08:00:00.000Z');
    expect(queries.find((q) => q.sql.includes('FROM bookings t'))!.params).toEqual(['2019-10-14']);
  });

  it('uses the stored periods', async () => {
    const { svc, queries } = makeService({ setting: JSON.stringify({ chatMonths: 3 }) });
    await svc.preview(at('2026-10-14T08:00:00Z'));
    const chat = queries.find((q) => q.sql.includes('chat_conversations'))!;
    expect((chat.params![0] as Date).toISOString()).toBe('2026-07-14T08:00:00.000Z');
  });

  it('refuses to save a period below its floor', async () => {
    const { svc, settingRepo } = makeService();
    await expect(svc.savePolicy({ bookingYears: 1 })).rejects.toBeInstanceOf(BadRequestException);
    expect(settingRepo.save).not.toHaveBeenCalled();
  });
});

describe('RetentionService run', () => {
  it('deletes in batched transactions until a short batch, then logs a summary row', async () => {
    const { svc, db } = makeService();
    let chatCalls = 0;
    db.transaction.mockImplementation(async (fn: (m: unknown) => unknown) => fn({
      query: async (sql: string) => {
        if (sql.includes('DELETE FROM chat_conversations')) { chatCalls++; return [{ n: chatCalls === 1 ? RETENTION_BATCH : 3 }]; }
        return sql.includes('DELETE') ? [{ n: 0 }] : [];
      },
    }));
    const counts = await svc.run('manual', at('2026-10-14T08:00:00Z'));
    expect(counts.chatConversations).toBe(RETENTION_BATCH + 3);
    expect(chatCalls).toBe(2);
    expect(db.transaction).toHaveBeenCalledTimes(RULES.length + 1 + 1);
    const insert = db.query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO retention_runs'))!;
    expect(insert[1]![1]).toBe(true);
    expect(JSON.parse(String(insert[1]![3])).chatConversations).toBe(RETENTION_BATCH + 3);
  });
});
