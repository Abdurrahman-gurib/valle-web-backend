import { NotFoundException } from '@nestjs/common';
import { groupBy, settingsMap } from './collections';
import { escapeHtml, escapeHtmlStrict } from './html';
import { noBooking, orNotFound } from './lookup';
import { partyText, rupees } from './money';
import { MAX_PAGE_SIZE, pageOffset, resolvePaging } from './paging';
import {
  addDays, dayMonthYear, isoDay, isoDayOrNull, localIsoDayOrNull, longDate, parkDateTime, startOfMonth, startOfNextMonth, toIso, weekday,
} from './park-time';

describe('park-time', () => {
  it('reads date columns as YYYY-MM-DD from strings and Dates', () => {
    expect(isoDay('2026-10-02')).toBe('2026-10-02');
    expect(isoDay('2026-10-02T23:00:00Z')).toBe('2026-10-02');
    expect(isoDay(new Date('2026-10-02T23:30:00Z'))).toBe('2026-10-02');
    expect(isoDayOrNull(null)).toBeNull();
    expect(isoDayOrNull(undefined)).toBeNull();
    expect(isoDayOrNull('2026-01-05')).toBe('2026-01-05');
    expect(localIsoDayOrNull(null)).toBeNull();
    expect(localIsoDayOrNull('2026-01-05xyz')).toBe('2026-01-05');
  });

  it('does calendar arithmetic across months, years and leap days', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-02', 0)).toBe('2026-10-02');
  });

  it('knows weekdays and month boundaries', () => {
    expect(weekday('2026-10-04')).toBe(0); // a Sunday
    expect(weekday('2026-10-02')).toBe(5);
    expect(startOfMonth('2026-10-17')).toBe('2026-10-01');
    expect(startOfNextMonth('2026-10-17')).toBe('2026-11-01');
    expect(startOfNextMonth('2026-12-31')).toBe('2027-01-01');
  });

  it('formats days and timestamps the way guests read them', () => {
    expect(longDate('2026-10-02')).toBe('Friday, 2 October 2026');
    expect(dayMonthYear('2026-10-02')).toBe('02/10/2026');
    expect(dayMonthYear(new Date('2026-10-02T08:00:00Z'))).toBe('02/10/2026');
    // 08:00 UTC is 12:00 in Mauritius (UTC+4, no DST)
    expect(parkDateTime(new Date('2026-09-30T08:00:00Z'))).toBe('30/09/2026, 12:00:00');
    expect(toIso('2026-09-30T08:00:00Z')).toBe('2026-09-30T08:00:00.000Z');
  });
});

describe('html', () => {
  it('escapes markup, the strict variant also the single quote', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry\'s&lt;/a&gt;');
    expect(escapeHtmlStrict(`Jerry's <b>`)).toBe('Jerry&#39;s &lt;b&gt;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('money', () => {
  it('writes rupees with thousands separators', () => {
    expect(rupees(12500)).toBe('Rs 12,500');
    expect(rupees(0)).toBe('Rs 0');
  });

  it('spells out the party', () => {
    expect(partyText(1, 0, ' and ')).toBe('1 adult');
    expect(partyText(2, 1, ' and ')).toBe('2 adults and 1 child');
    expect(partyText(2, 3, ' · ')).toBe('2 adults · 3 children');
  });
});

describe('collections', () => {
  it('groups rows by key, keeping input order', () => {
    const g = groupBy([{ k: 'a', n: 1 }, { k: 'b', n: 2 }, { k: 'a', n: 3 }], (r) => r.k);
    expect([...g.keys()]).toEqual(['a', 'b']);
    expect(g.get('a')?.map((r) => r.n)).toEqual([1, 3]);
  });

  it('turns settings rows into a map', () => {
    expect(settingsMap([{ key: 'a', value: '1' }]).get('a')).toBe('1');
  });
});

describe('lookup', () => {
  it('passes values through and 404s on null / undefined', () => {
    expect(orNotFound(0)).toBe(0);
    expect(() => orNotFound(null, 'No such payment')).toThrow(new NotFoundException('No such payment'));
    expect(() => orNotFound(undefined)).toThrow(NotFoundException);
    expect(noBooking('VAL-1234-26').message).toBe('No booking VAL-1234-26');
  });
});

describe('paging', () => {
  it('clamps page and pageSize', () => {
    expect(resolvePaging({})).toEqual({ page: 1, pageSize: 25 });
    expect(resolvePaging({ page: 0, pageSize: 0 })).toEqual({ page: 1, pageSize: 25 });
    expect(resolvePaging({ page: 3.7, pageSize: 1000 })).toEqual({ page: 3, pageSize: MAX_PAGE_SIZE });
    expect(pageOffset({ page: 3, pageSize: 20 })).toBe(40);
  });
});
