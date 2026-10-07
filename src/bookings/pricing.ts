import { type Product, isProductId, productAmount, productKeyOf } from '../entities';
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
  /** Session start time ("10:30") when the experience runs in sessions. */
  time?: string;
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
  /** Set instead of experienceId for a package / combo / VIP / photo / cinematic line. */
  productKey: string | null;
  variant: string;
  label: string;
  time: string | null;
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

/** How a booking's price is adjusted after the Explorer Pass discount. */
export type AdjustmentKind = 'none' | 'percent' | 'amount' | 'foc' | 'entry_free';
export const ADJUSTMENT_KINDS: AdjustmentKind[] = ['none', 'percent', 'amount', 'foc', 'entry_free'];

/**
 * Rupees taken off by an FOC pass, a percentage or fixed discount, or free
 * park entry. Never more than what is left to pay.
 */
export function adjustmentAmount(kind: AdjustmentKind, value: number, priced: { subtotal: number; discount: number; entry: number }): number {
  const due = Math.max(0, priced.subtotal - priced.discount);
  switch (kind) {
    case 'foc': return due;
    case 'percent': return Math.min(due, Math.round((due * Math.max(0, Math.min(100, value))) / 100));
    case 'amount': return Math.min(due, Math.max(0, Math.round(value)));
    case 'entry_free': return Math.min(due, priced.entry);
    default: return 0;
  }
}

export function computeBooking(
  experiences: PricingExperience[],
  settings: PricingSettings,
  input: PricingInput,
  priceRows: PricingPriceRow[] = [],
  products: Product[] = [],
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

  // The student price list (school groups) already includes the entrance fee.
  const studentRate = input.items.some((i) => isProductId(i.id) && products.find((p) => p.key === productKeyOf(i.id))?.family === 'student');
  const entry = studentRate ? 0 : entryAdult * input.adults + entryChild * input.kids;
  const lines: PricedLine[] = [
    {
      experienceId: null,
      variant: '',
      label: 'Park entry · ' + (studentRate ? 'included with the student rate' : partyLabel(input.adults, input.kids)),
      productKey: null,
      time: null,
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
  const productById = new Map(products.map((p) => [p.key, p]));
  const productItems = input.items.filter((i) => isProductId(i.id));
  const expItems = input.items.filter((i) => !isProductId(i.id));
  for (const item of productItems) {
    const p = productById.get(productKeyOf(item.id));
    if (!p || !p.active) throw new BadRequestException(`Unknown product "${item.id}"`);
    if (p.rateOnly && p.rateOnly !== input.rate) throw new BadRequestException(`"${p.name}" is for ${p.rateOnly === 'rr' ? 'residents' : 'visitors'} only`);
  }
  input = { ...input, items: expItems };

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
      productKey: null,
      variant: item.variant || '',
      label: exp.name + (item.variant ? ' · ' + item.variant : '') + ' · ' + q + (item.time ? ' · ' + item.time : ''),
      time: item.time || null,
      adults: a,
      kids: k,
      units: u,
      amount,
    });
  }

  for (const item of productItems) {
    const p = productById.get(productKeyOf(item.id))!;
    const a = item.adults || 0;
    const k = item.kids || 0;
    const u = p.mode === 'flat' ? Math.max(1, item.units || 0) : 0;
    const amount = productAmount(p, input.rate, a, k, u);
    const q = p.mode === 'flat' ? `${u} × ${p.family === 'cine' ? 'film' : 'unit'}` : partyLabel(a, k);
    subtotal += amount;
    lines.push({ experienceId: null, productKey: p.key, variant: '', label: p.name + ' · ' + q, time: null, adults: a, kids: k, units: u, amount });
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
