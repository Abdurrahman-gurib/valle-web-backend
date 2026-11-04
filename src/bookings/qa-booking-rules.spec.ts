import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { Booking, BookingLine, Product } from '../entities';
import { TicketService } from '../tickets/ticket.service';
import {
  activitiesOf, gateChecks, onLine, packageActivityIds, waiverRequiredCount, DEFAULT_WAIVER_ACTIVITIES, type GateActivity,
} from '../waivers/waiver-rules';
import { productActivityMap } from '../waivers/waiver-products';
import { assertAgeMinimums, assertLinesFitParty } from './party-rules';
import { computeBooking, partyLabel, type PricingExperience } from './pricing';
import { BookingsService } from './bookings.service';

const SETTINGS = { entryAdult: 500, entryChild: 250 };
const ADMISSION = [
  { groupKey: 'admission', label: '12 years old & above', rr: 400, nr: 550 },
  { groupKey: 'admission', label: '6 to 11 years old', rr: 275, nr: 325 },
];
const exp = (id: string, name: string, price: number, sortOrder: number): PricingExperience => ({
  id, name, categoryId: 'adventure', basePrice: price, priceMode: 'pp', flatLabel: null, priceRr: null, priceNr: null, sortOrder,
});
const EXPS = [exp('zipline', 'Zipline Adventures', 1600, 0), exp('luge', 'Mountain Luge Kart', 800, 1)];
const product = (key: string, family: string, name: string, price: number, extra: Partial<Product> = {}): Product => ({
  key, family, name, mode: 'pp', priceRr: price, priceNr: price, dblRr: null, dblNr: null, rateOnly: null, image: '', note: '',
  sortOrder: 0, active: true, wasPrice: null, contents: null, validFrom: null, validTo: null, ...extra,
} as Product);
const GO = product('expo:go', 'expo', 'GO-PACKAGE', 1975, { rateOnly: 'rr', contents: ['Giant Swing (1 ride)', 'Mountain Luge Kart (1 ride)', 'Nepalese Bridge', 'The Plunge Zipline (500 m)', 'Free entrance'] });
const SENIOR = product('pkg:senior:0', 'senior', 'Package 1', 1100, { rateOnly: 'rr' });
const STUDENT_ENTRY = product('student:0', 'student', 'Entrance fee · visit of the park', 200);
const STUDENT_LUNCH = product('student:12', 'student', 'Lunch menu · 4 to 11 yrs', 250);
const STUDENT_ZIP = product('student:8', 'student', 'Signature Zipline · 1.5 km', 800);

const names: Record<string, { name: string; ageLabel?: string }> = {
  giantswing: { name: 'The Giant Swing', ageLabel: '12+' },
  zipline: { name: 'Zipline Adventures', ageLabel: '8+' },
  coaster: { name: 'Roller Coaster Express', ageLabel: '4–12' },
  'product:expo:go': { name: 'GO-PACKAGE' },
};
const info = (id: string) => names[id];

describe('party rules (QA 4, 5)', () => {
  const party = { adults: 2, kids: 1, infants: 1 };
  it('refuses a line counting more people than the party, naming it', () => {
    expect(() => assertLinesFitParty([{ id: 'zipline', adults: 3 }], party, info)).toThrow('Zipline Adventures cannot count more people than the party');
    expect(() => assertLinesFitParty([{ id: 'product:expo:go', adults: 2, kids: 3 }], party, info)).toThrow('GO-PACKAGE cannot count more people than the party');
    expect(() => assertLinesFitParty([{ id: 'unknown', kids: 9 }], party, info)).toThrow('unknown cannot count more people than the party');
  });
  it('lets an under-6 ride as a child (Kids Park), within the party', () => {
    expect(() => assertLinesFitParty([{ id: 'coaster', adults: 0, kids: 2 }], party, info)).not.toThrow();
    expect(() => assertLinesFitParty([{ id: 'coaster', adults: 2, kids: 2 }], party, info)).not.toThrow();
  });
  it('refuses children 6–11 on a 12+ experience only', () => {
    expect(() => assertAgeMinimums([{ id: 'giantswing', adults: 1, kids: 1 }], info)).toThrow(new BadRequestException('The Giant Swing is for ages 12+ only'));
    expect(() => assertAgeMinimums([{ id: 'giantswing', adults: 2 }], info)).not.toThrow();
    expect(() => assertAgeMinimums([{ id: 'zipline', kids: 1 }], info)).not.toThrow(); // 8+: the instructor checks
    expect(() => assertAgeMinimums([{ id: 'coaster', kids: 1, adults: 1 }], info)).not.toThrow(); // no max-age refusal
  });

  it('the hold endpoint rejects line counts above the party before holding anything', async () => {
    const svc = new BookingsService(
      { transaction: jest.fn() } as never, {} as never, {} as never,
      { find: jest.fn(async () => [{ id: 'zipline', name: 'Zipline Adventures', ageLabel: '8+' }]) } as never,
      {} as never, { find: jest.fn(async () => []) } as never, {} as never,
      { find: jest.fn(async () => []) } as never, {} as never,
    );
    await expect(svc.hold({ visitDate: '2030-01-01', slot: 'morning', adults: 1, kids: 0, items: [{ id: 'zipline', adults: 2 }] }))
      .rejects.toThrow('Zipline Adventures cannot count more people than the party');
  });
});

describe('partyLabel', () => {
  it('hides zero parts and pluralises', () => {
    expect(partyLabel(0, 1)).toBe('1 child');
    expect(partyLabel(1, 0)).toBe('1 adult');
    expect(partyLabel(2, 3, 1)).toBe('2 adults · 3 children · 1 under 6');
    expect(partyLabel(0, 0, 2)).toBe('2 under 6');
    expect(partyLabel(0, 0)).toBe('0 adults');
  });
});

describe('entry coverage (QA 6, 7, 8)', () => {
  it('under-6s pay no entry and are named on the entry line', () => {
    const r = computeBooking(EXPS, SETTINGS, { adults: 2, kids: 1, infants: 1, rate: 'rr', items: [] }, ADMISSION);
    expect(r.entry).toBe(400 * 2 + 275);
    expect(r.lines[0].label).toBe('Park entry · 2 adults · 1 child · 1 under 6');
  });
  it('senior packages include the entrance', () => {
    const r = computeBooking(EXPS, SETTINGS, { adults: 2, kids: 0, rate: 'rr', items: [{ id: 'product:pkg:senior:0', adults: 2 }] }, ADMISSION, [SENIOR]);
    expect(r.entry).toBe(0);
    expect(r.lines[0].label).toBe('Park entry · included with the senior package');
    expect(r.total).toBe(2200);
  });
  it('an expo deal covers only the people on its line', () => {
    const r = computeBooking(EXPS, SETTINGS, { adults: 2, kids: 2, rate: 'rr', visitDate: '2026-11-20', items: [{ id: 'product:expo:go', adults: 1, kids: 1 }] }, ADMISSION, [GO]);
    expect(r.entry).toBe(400 + 275);
    expect(r.lines[0].label).toBe('Park entry · 1 adult · 1 child');
    expect(r.total).toBe(400 + 275 + 1975 * 2);
  });
  it('two expo lines for different people add up (capped at the party)', () => {
    const PLUS = product('expo:plus', 'expo', 'PLUS-PACKAGE', 2175, { rateOnly: 'rr' });
    const r = computeBooking(EXPS, SETTINGS, { adults: 2, kids: 0, rate: 'rr', items: [{ id: 'product:expo:go', adults: 1 }, { id: 'product:expo:plus', adults: 2 }] }, ADMISSION, [GO, PLUS]);
    expect(r.entry).toBe(0);
  });
  it('a school: pupils covered by the student entrance row, teachers pay adult entry, rows priced per quantity', () => {
    // 2 teachers + 4 pupils 12+ (adults), 30 pupils 6–11, 4 pre-primary
    const r = computeBooking(EXPS, SETTINGS, {
      adults: 6, kids: 30, infants: 4, rate: 'rr',
      items: [
        { id: 'product:student:0', adults: 4, kids: 30 },
        { id: 'product:student:12', adults: 0, kids: 34 }, // lunch 4–11: the 6–11s and the pre-primary
        { id: 'product:student:8', adults: 4, kids: 10 },
      ],
    }, ADMISSION, [STUDENT_ENTRY, STUDENT_LUNCH, STUDENT_ZIP]);
    expect(r.entry).toBe(400 * 2);
    expect(r.lines[0].label).toBe('Park entry · 2 adults');
    const amounts = Object.fromEntries(r.lines.filter((l) => l.productKey).map((l) => [l.productKey, l.amount]));
    expect(amounts).toEqual({ 'student:0': 200 * 34, 'student:12': 250 * 34, 'student:8': 800 * 14 });
    expect(r.total).toBe(800 + 6800 + 8500 + 11200);
  });
  it('a school with no teachers paying: entry reads as included', () => {
    const r = computeBooking(EXPS, SETTINGS, { adults: 2, kids: 10, rate: 'rr', items: [{ id: 'product:student:0', adults: 2, kids: 10 }] }, ADMISSION, [STUDENT_ENTRY]);
    expect(r.lines[0]).toMatchObject({ amount: 0, label: 'Park entry · included with the student rate' });
  });
});

describe('waivers for packages and per-person gate checks (QA 6, 11)', () => {
  const EXPERIENCES = [{ id: 'zipline', name: 'Zipline Adventures' }, { id: 'peak', name: 'The Peak' }];
  it('maps package wording to experiences, most specific first', () => {
    expect(packageActivityIds(GO.contents ?? [], EXPERIENCES).sort()).toEqual(['giantswing', 'luge', 'nepalese', 'zipline']);
    expect(packageActivityIds(['Nepalese Bridge OR Bicycle Zipline']).sort()).toEqual(['bicycle', 'nepalese']);
    expect(packageActivityIds(['The Discovery Tour (1.6 km · 7 lines)', 'Sky Pulse Tour (3.1 km, 7 lines)', 'Advenature Flight (5.5 km, 11 lines)'])).toEqual(['zipline']);
    expect(packageActivityIds(['Exclusive Quad Adventure (1 hour)', 'The Peak', 'Lunch, Discovery Menu', 'Admission fee'], EXPERIENCES).sort()).toEqual(['peak', 'quad']);
    expect(packageActivityIds(['Bonding Roller Coaster Zipline', 'Roller Coaster Express', 'Mini Quad'])).toEqual(['bonding', 'coaster', 'miniquad']);
  });
  it('a package-only booking needs waivers; Giant Swing and the Kids Park stay out of the list', () => {
    expect(DEFAULT_WAIVER_ACTIVITIES).not.toEqual(expect.arrayContaining(['giantswing']));
    for (const id of ['coaster', 'pirate', 'bonding']) expect(DEFAULT_WAIVER_ACTIVITIES).not.toContain(id);
    const lines = [{ experienceId: null, productKey: null, adults: 2, kids: 1, units: 0 }, { experienceId: null, productKey: 'expo:go', adults: 2, kids: 1, units: 0 }];
    const packages = new Map([['expo:go', ['giantswing', 'luge', 'nepalese', 'zipline']]]);
    expect(waiverRequiredCount(lines, DEFAULT_WAIVER_ACTIVITIES, { adults: 2, kids: 1 })).toBe(0);
    expect(waiverRequiredCount(lines, DEFAULT_WAIVER_ACTIVITIES, { adults: 2, kids: 1 }, packages)).toBe(3);
    expect(waiverRequiredCount(lines, DEFAULT_WAIVER_ACTIVITIES, { adults: 2, kids: 1, infants: 1 }, packages)).toBe(4);
    expect(waiverRequiredCount([{ experienceId: null, productKey: 'x', adults: 2, kids: 0, units: 0 }], DEFAULT_WAIVER_ACTIVITIES, { adults: 2, kids: 0, infants: 1 })).toBe(0);
    const swingOnly = new Map([['p', ['giantswing']]]);
    expect(waiverRequiredCount([{ experienceId: null, productKey: 'p', adults: 2, kids: 0, units: 0 }], DEFAULT_WAIVER_ACTIVITIES, { adults: 2, kids: 0 }, swingOnly)).toBe(0);
  });
  it('reads package contents through the repository manager, and copes without one', async () => {
    expect((await productActivityMap(undefined, ['expo:go'])).size).toBe(0);
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM products')) return [{ key: 'expo:go', name: 'GO-PACKAGE', contents: GO.contents }, { key: 'pkg:ls:0', name: 'Light', contents: null }];
      if (sql.includes('FROM experiences')) return EXPERIENCES;
      if (sql.includes('package_tiers')) return [{ k: 'ls:0', text: 'Quad Adventure (1 h)' }, { k: 'ls:0', text: 'Discovery Tour ziplines (7 lines)' }];
      return [];
    });
    const map = await productActivityMap({ query } as never, ['expo:go', 'pkg:ls:0', null]);
    expect(map.get('expo:go')?.sort()).toEqual(['giantswing', 'luge', 'nepalese', 'zipline']);
    expect(map.get('pkg:ls:0')?.sort()).toEqual(['quad', 'zipline']);
  });
  it('flags only rides the person is on; partial lines go to one gate check', () => {
    const party = { adults: 2, kids: 2 };
    expect(onLine(30, { adults: 2, kids: 0 }, party)).toBe('yes');
    expect(onLine(8, { adults: 2, kids: 0 }, party)).toBe('no');
    expect(onLine(8, { adults: 0, kids: 2 }, party)).toBe('yes');
    expect(onLine(8, { adults: 0, kids: 1 }, party)).toBe('unknown');
    expect(onLine(4, { adults: 0, kids: 2 }, party)).toBe('no');
    expect(onLine(4, { adults: 0, kids: 3 }, party)).toBe('unknown');
    const acts: GateActivity[] = [
      { id: 'zipline', name: 'Zipline Adventures', limits: { minAge: 8 }, people: { adults: 2, kids: 0 } },
      { id: 'giantswing', name: 'The Giant Swing', limits: { minAge: 12 }, people: { adults: 1, kids: 0 } },
      { id: 'buggy', name: 'Buggy', limits: { driveMinAge: 16 } },
    ];
    expect(activitiesOf(7, acts, party).map((a) => a.id)).toEqual(['buggy']);
    expect(activitiesOf(40, acts, party).map((a) => a.id)).toEqual(['zipline', 'buggy']);
    expect(gateChecks(acts, party)).toEqual([{ activity: 'The Giant Swing', message: 'The Giant Swing · 1 of 4 people booked: check age 12+ at the gate' }]);
  });
});

describe('ticket links keep the guest language (QA 12)', () => {
  const config = { get: (k: string) => ({ JWT_SECRET: 'x'.repeat(40), SITE_URL: 'https://example.test' } as Record<string, string>)[k] } as unknown as ConfigService;
  const t = new TicketService(config, {} as Repository<Booking>, {} as Repository<BookingLine>, {} as never, {} as never);
  it('prefixes non-English languages only', () => {
    expect(t.ticketUrl('VAL-1234-26', 'fr')).toMatch(/^https:\/\/example\.test\/fr\/ticket\/VAL-1234-26\?t=/);
    expect(t.waiverUrl('VAL-1234-26', 'ar')).toMatch(/^https:\/\/example\.test\/ar\/waiver\/VAL-1234-26\?t=/);
    expect(t.ticketUrl('VAL-1234-26', 'en')).toMatch(/^https:\/\/example\.test\/ticket\//);
    expect(t.ticketUrl('VAL-1234-26', 'xx')).toMatch(/^https:\/\/example\.test\/ticket\//);
    expect(t.ticketUrl('VAL-1234-26')).toMatch(/^https:\/\/example\.test\/ticket\//);
  });
});
