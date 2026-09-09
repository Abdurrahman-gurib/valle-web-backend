import { BadRequestException } from '@nestjs/common';
import {
  computeBooking,
  partyLabel,
  PricingExperience,
  PricingSettings,
} from './pricing';

const SETTINGS: PricingSettings = { entryAdult: 500, entryChild: 250 };

let nextSortOrder = 0;
const exp = (over: Partial<PricingExperience>): PricingExperience => ({
  id: 'x',
  name: 'X',
  categoryId: 'adventure',
  basePrice: 0,
  priceMode: 'pp',
  flatLabel: null,
  priceRr: null,
  priceNr: null,
  sortOrder: nextSortOrder++, // declaration order stands in for catalog order
  ...over,
});

const EXPS: PricingExperience[] = [
  exp({
    id: 'zipline',
    name: 'Zipline Adventures',
    basePrice: 1600,
    priceRr: 875,
    priceNr: 1375,
  }),
  exp({
    id: 'nepalese',
    name: 'Nepalese Bridge',
    basePrice: 900,
    priceRr: 700,
    priceNr: 1300,
  }),
  exp({
    id: 'luge',
    name: 'Mountain Luge Kart',
    basePrice: 800,
    priceRr: 500,
    priceNr: 700,
  }),
  exp({
    id: 'buggy',
    name: 'Buggy',
    basePrice: 3200,
    priceMode: 'flat',
    flatLabel: '/ buggy',
    priceRr: 6200,
    priceNr: 7500,
  }),
  exp({
    id: 'pirate',
    name: 'Pirate Ship',
    categoryId: 'kids',
    basePrice: 350,
  }),
  exp({
    id: 'waterfalls',
    name: 'Waterfalls',
    categoryId: 'nature',
    priceMode: 'entry',
  }),
  exp({
    id: 'kaz',
    name: 'Kaz Bon Bon',
    categoryId: 'kids',
    priceMode: 'kiosk',
  }),
];

const input = (
  items: { id: string; adults?: number; kids?: number; units?: number }[],
  over: Partial<{ adults: number; kids: number; rate: 'rr' | 'nr' }> = {},
) => ({ adults: 2, kids: 1, rate: 'rr' as const, ...over, items });

describe('mirroring of the frontend pricing rules', () => {
  it('emits lines in catalog order, not request order', () => {
    // The guest's on-screen summary is built by filtering the catalog, so the
    // receipt reads zipline-then-luge however the cards were tapped.
    const r = computeBooking(
      EXPS,
      SETTINGS,
      input([{ id: 'luge', adults: 1 }, { id: 'zipline', adults: 1 }]),
    );
    expect(r.lines.map((l) => l.experienceId)).toEqual([null, 'zipline', 'luge']);
  });

  it('quotes base price for both rates when an experience is not rate-dependent', () => {
    // priceRr null => absent from RATEP => the client shows basePrice for both rates.
    const half = [exp({ id: 'nr-only', name: 'NR Only', basePrice: 1600, priceNr: 1375 })];
    const rr = computeBooking(half, SETTINGS, input([{ id: 'nr-only', adults: 1 }], { adults: 1, kids: 0, rate: 'rr' }));
    const nr = computeBooking(half, SETTINGS, input([{ id: 'nr-only', adults: 1 }], { adults: 1, kids: 0, rate: 'nr' }));
    expect(rr.lines[1].amount).toBe(1600);
    expect(nr.lines[1].amount).toBe(1600);
  });
});

describe('partyLabel', () => {
  it('formats singular and plural parties', () => {
    expect(partyLabel(1, 0)).toBe('1 adult');
    expect(partyLabel(2, 1)).toBe('2 adults · 1 child');
    expect(partyLabel(3, 2)).toBe('3 adults · 2 children');
  });
});

describe('computeBooking', () => {
  it('prices an entry-only booking (no items)', () => {
    const r = computeBooking(EXPS, SETTINGS, input([]));
    expect(r.entry).toBe(500 * 2 + 250 * 1);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({
      experienceId: null,
      label: 'Park entry · 2 adults · 1 child',
      amount: 1250,
    });
    expect(r.discount).toBe(0);
    expect(r.subtotal).toBe(1250);
    expect(r.total).toBe(1250);
  });

  it('prices pp items with kids at half price, rounded', () => {
    // zipline rr = 875; kid = Math.round(437.5) = 438
    const r = computeBooking(
      EXPS,
      SETTINGS,
      input([{ id: 'zipline', adults: 1, kids: 1 }], { adults: 1, kids: 1 }),
    );
    expect(r.lines[1]).toMatchObject({
      experienceId: 'zipline',
      label: 'Zipline Adventures · 1 adult · 1 child',
      amount: 875 + 438,
    });
    expect(r.total).toBe(500 + 250 + 875 + 438);
  });

  it('prices flat items per unit with a "N × unit" label', () => {
    const r = computeBooking(
      EXPS,
      SETTINGS,
      input([{ id: 'buggy', units: 2 }], { adults: 2, kids: 0 }),
    );
    expect(r.lines[1]).toMatchObject({
      experienceId: 'buggy',
      label: 'Buggy · 2 × buggy',
      amount: 6200 * 2,
    });
    expect(r.total).toBe(1000 + 12400);
  });

  it('selects nr vs rr rates, falling back to base price', () => {
    const rr = computeBooking(
      EXPS,
      SETTINGS,
      input([{ id: 'zipline', adults: 1 }], { adults: 1, kids: 0 }),
    );
    const nr = computeBooking(
      EXPS,
      SETTINGS,
      input([{ id: 'zipline', adults: 1 }], { adults: 1, kids: 0, rate: 'nr' }),
    );
    expect(rr.lines[1].amount).toBe(875);
    expect(nr.lines[1].amount).toBe(1375);

    // pirate has no rr/nr prices, so base price applies at either rate
    const fallback = computeBooking(
      EXPS,
      SETTINGS,
      input([{ id: 'pirate', adults: 1 }], { adults: 1, kids: 0, rate: 'nr' }),
    );
    expect(fallback.lines[1].amount).toBe(350);
  });

  it('applies the 15% Explorer Pass discount at exactly 3 adventure pp items', () => {
    const r = computeBooking(
      EXPS,
      SETTINGS,
      input(
        [
          { id: 'zipline', adults: 1 },
          { id: 'nepalese', adults: 1 },
          { id: 'luge', adults: 1 },
        ],
        { adults: 1, kids: 0 },
      ),
    );
    const advSubtotal = 875 + 700 + 500;
    expect(r.advCount).toBe(3);
    expect(r.discount).toBe(Math.round(advSubtotal * 0.15)); // 311
    expect(r.total).toBe(500 + advSubtotal - 311);
  });

  it('does not discount at only 2 adventure pp items', () => {
    const r = computeBooking(
      EXPS,
      SETTINGS,
      input(
        [
          { id: 'zipline', adults: 1 },
          { id: 'nepalese', adults: 1 },
        ],
        { adults: 1, kids: 0 },
      ),
    );
    expect(r.advCount).toBe(2);
    expect(r.discount).toBe(0);
  });

  it('does not count flat items or zero-amount items toward the discount', () => {
    const r = computeBooking(
      EXPS,
      SETTINGS,
      input(
        [
          { id: 'zipline', adults: 1 },
          { id: 'nepalese', adults: 1 },
          { id: 'buggy', units: 1 }, // flat, never counts
          { id: 'luge' }, // zero quantity, kept as a 0-amount line
        ],
        { adults: 1, kids: 0 },
      ),
    );
    expect(r.advCount).toBe(2);
    expect(r.discount).toBe(0);
    const lugeLine = r.lines.find((l) => l.experienceId === 'luge');
    expect(lugeLine).toMatchObject({
      label: 'Mountain Luge Kart · 0 adult',
      amount: 0,
    });
  });

  it('rejects unknown experience ids', () => {
    expect(() =>
      computeBooking(EXPS, SETTINGS, input([{ id: 'nope', adults: 1 }])),
    ).toThrow(BadRequestException);
  });

  it('rejects duplicate experience ids', () => {
    expect(() =>
      computeBooking(
        EXPS,
        SETTINGS,
        input(
          [
            { id: 'zipline', adults: 1 },
            { id: 'nepalese', adults: 1 },
            { id: 'zipline', adults: 1 },
          ],
          { adults: 1, kids: 0 },
        ),
      ),
    ).toThrow(BadRequestException);
  });

  it('cannot earn the discount by splitting one adventure into 3 entries', () => {
    // 3 × the same ride must not qualify: only 3 DISTINCT adventures do.
    expect(() =>
      computeBooking(
        EXPS,
        SETTINGS,
        input(
          [
            { id: 'zipline', adults: 1 },
            { id: 'zipline', adults: 1 },
            { id: 'zipline', adults: 1 },
          ],
          { adults: 3, kids: 0 },
        ),
      ),
    ).toThrow(BadRequestException);

    // the equivalent single-entry booking is the only legal shape, and it is undiscounted
    const single = computeBooking(
      EXPS,
      SETTINGS,
      input([{ id: 'zipline', adults: 3 }], { adults: 3, kids: 0 }),
    );
    expect(single.advCount).toBe(1);
    expect(single.discount).toBe(0);
    expect(single.total).toBe(500 * 3 + 875 * 3);
  });

  it('rejects entry- and kiosk-mode experiences as paid items', () => {
    expect(() =>
      computeBooking(EXPS, SETTINGS, input([{ id: 'waterfalls', adults: 1 }])),
    ).toThrow(BadRequestException);
    expect(() =>
      computeBooking(EXPS, SETTINGS, input([{ id: 'kaz', adults: 1 }])),
    ).toThrow(BadRequestException);
  });
});
