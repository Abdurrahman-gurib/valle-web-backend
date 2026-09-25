import { BadRequestException } from '@nestjs/common';

/**
 * Server-side pricing: an EXACT mirror of Frontend/src/store/booking.ts
 * (computeBooking + priceFor) and Frontend/src/lib/format.ts (partyLabel).
 * Never trusts client totals; recomputes everything from DB rows.
 */

export interface PricingExperience {
  id: string;
  name: string;
  categoryId: string;
  basePrice: number;
  priceMode: 'pp' | 'flat' | 'entry' | 'kiosk';
  flatLabel: string | null;
  priceRr: number | null;
  priceNr: number | null;
  sortOrder: number;
}

export interface PricingSettings {
  entryAdult: number;
  entryChild: number;
}

export interface PricingItem {
  id: string;
  /** price_list label of the option booked; undefined / '' = base price */
  variant?: string;
  adults?: number;
  kids?: number;
  units?: number;
}

/** A price_list row: one priced option of an experience (group_key = experience id). */
export interface PricingPriceRow {
  groupKey: string;
  label: string;
  rr: number;
  nr: number;
}

export interface PricingInput {
  adults: number;
  kids: number;
  rate: 'rr' | 'nr';
  items: PricingItem[];
}

export interface PricedLine {
  experienceId: string | null;
  variant: string;
  label: string;
  adults: number;
  kids: number;
  units: number;
  amount: number;
}

export interface PricedBooking {
  lines: PricedLine[];
  entry: number;
  /** before discount, incl. entry */
  subtotal: number;
  discount: number;
  total: number;
  advCount: number;
}

/** "2 adults · 1 child" party label, a mirror of Frontend/src/lib/format.ts. */
export function partyLabel(adults: number, kids: number): string {
  return (
    adults +
    ' adult' +
    (adults > 1 ? 's' : '') +
    (kids > 0 ? ' · ' + kids + ' child' + (kids > 1 ? 'ren' : '') : '')
  );
}

/**
 * Rate-aware price for an experience, a mirror of Frontend priceFor().
 * An experience is rate-dependent only when priceRr is set: that is exactly the
 * condition under which CatalogService emits a RATEP entry, and the client
 * quotes basePrice for BOTH rates when RATEP has no entry. Falling back per-rate
 * instead would charge a priceNr-only row differently from the quoted price.
 */
export function priceFor(
  exp: PricingExperience,
  rate: 'rr' | 'nr',
): number {
  if (exp.priceRr == null) return exp.basePrice;
  return rate === 'nr' ? exp.priceNr ?? exp.priceRr : exp.priceRr;
}

export function computeBooking(
  experiences: PricingExperience[],
  settings: PricingSettings,
  input: PricingInput,
  priceRows: PricingPriceRow[] = [],
): PricedBooking {
  const byId = new Map(experiences.map((e) => [e.id, e]));
  const lineKey = (item: PricingItem) => item.id + '::' + (item.variant || '');

  // Park entry follows the printed admission rows when they exist (RR 400/275, NR 550/325);
  // the flat settings values are only a fallback for a database without them.
  const admission = (needle: string) =>
    priceRows.find((r) => r.groupKey === 'admission' && r.label.toLowerCase().includes(needle));
  const adultRow = admission('12 years');
  const childRow = admission('6 to 11');
  const entryAdult = adultRow ? (input.rate === 'nr' ? adultRow.nr : adultRow.rr) : settings.entryAdult;
  const entryChild = childRow ? (input.rate === 'nr' ? childRow.nr : childRow.rr) : settings.entryChild;

  const entry = entryAdult * input.adults + entryChild * input.kids;
  const lines: PricedLine[] = [
    {
      experienceId: null,
      variant: '',
      label: 'Park entry · ' + partyLabel(input.adults, input.kids),
      adults: input.adults,
      kids: input.kids,
      units: 0,
      amount: entry,
    },
  ];

  let subtotal = entry;
  let advSubtotal = 0;
  const advIds = new Set<string>();

  // The client keys its selection by experience id + option, so duplicates can
  // never be legitimate. (The Explorer Pass counts DISTINCT experiences, so two
  // options of the same experience are fine but never inflate the discount.)
  const seen = new Set<string>();
  for (const item of input.items) {
    const key = lineKey(item);
    if (seen.has(key)) {
      throw new BadRequestException(`Duplicate experience "${item.id}" in items`);
    }
    seen.add(key);
    if (!byId.has(item.id)) {
      throw new BadRequestException(`Unknown experience "${item.id}"`);
    }
    if (
      item.variant &&
      !priceRows.some((r) => r.groupKey === item.id && r.label === item.variant)
    ) {
      throw new BadRequestException(
        `Unknown option "${item.variant}" for experience "${item.id}"`,
      );
    }
  }

  // The guest's on-screen summary lists experiences in catalog order
  // (Frontend booking.ts filters catalog.ACTS), while the request carries them in
  // tap order; sort so the persisted lines and the printed receipt agree.
  const ordered = [...input.items].sort(
    (x, y) => byId.get(x.id)!.sortOrder - byId.get(y.id)!.sortOrder,
  );

  for (const item of ordered) {
    const exp = byId.get(item.id)!;
    if (exp.priceMode === 'entry' || exp.priceMode === 'kiosk') {
      throw new BadRequestException(
        `Experience "${item.id}" is included with park entry and cannot be booked as a paid item`,
      );
    }

    const row = item.variant
      ? priceRows.find((r) => r.groupKey === exp.id && r.label === item.variant)
      : undefined;
    const price = row
      ? input.rate === 'nr'
        ? row.nr
        : row.rr
      : priceFor(exp, input.rate);
    const a = item.adults || 0;
    const k = item.kids || 0;
    const u = item.units || 0;
    let amount = 0;
    let q = '';

    if (exp.priceMode === 'flat') {
      amount = price * u;
      q =
        u +
        ' × ' +
        (exp.flatLabel ? exp.flatLabel.replace('/', '').trim() : 'unit');
    } else {
      amount = price * a + Math.round(price * 0.5) * k;
      q = partyLabel(a, k);
    }

    subtotal += amount;
    if (exp.categoryId === 'adventure' && exp.priceMode === 'pp' && amount > 0) {
      advSubtotal += amount;
      advIds.add(exp.id);
    }
    lines.push({
      experienceId: exp.id,
      variant: item.variant || '',
      label: exp.name + (item.variant ? ' · ' + item.variant : '') + ' · ' + q,
      adults: a,
      kids: k,
      units: u,
      amount,
    });
  }

  const advCount = advIds.size;
  const discount = advCount >= 3 ? Math.round(advSubtotal * 0.15) : 0;
  return {
    lines,
    entry,
    subtotal,
    discount,
    total: subtotal - discount,
    advCount,
  };
}
