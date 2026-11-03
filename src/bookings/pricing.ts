import { type Product, ENTRY_INCLUDED_FAMILIES, isProductId, productAmount, productKeyOf, productValidOn } from '../entities';
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
  /** Visit date (YYYY-MM-DD): products with a validity window are refused outside it. Omitted = not checked. */
  visitDate?: string;
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

/** The Explorer Pass: this many distinct adventure experiences earn the discount... */
export const EXPLORER_PASS_MIN_EXPERIENCES = 3;
/** ...of this share of what those experiences cost. */
export const EXPLORER_PASS_RATE = 0.15;
/** Children pay half the per-person price of an experience (rounded per child). */
const CHILD_SHARE = 0.5;

/** Default park entry when the settings table has no value (the printed admission rows normally win). */
const DEFAULT_ENTRY_ADULT = '500';
const DEFAULT_ENTRY_CHILD = '250';
/** Share of a group booking's total asked up front when `group_deposit_percent` is unusable. */
const DEFAULT_GROUP_DEPOSIT_PERCENT = 30;

/** Fallback entry prices from the settings rows `entry_adult` / `entry_child`. */
export function entrySettings(settings: ReadonlyMap<string, string>): PricingSettings {
  return {
    entryAdult: parseInt(settings.get('entry_adult') ?? DEFAULT_ENTRY_ADULT, 10),
    entryChild: parseInt(settings.get('entry_child') ?? DEFAULT_ENTRY_CHILD, 10),
  };
}

/**
 * Rupees a group pays up front: `group_deposit_percent` of the total (30 % by
 * default, capped at 100 %; a negative or non-numeric setting means 30 %).
 */
export function groupDepositAmount(total: number, percentSetting: string | undefined): number {
  const pct = Number(percentSetting ?? String(DEFAULT_GROUP_DEPOSIT_PERCENT));
  const share = Number.isFinite(pct) && pct >= 0 ? Math.min(100, pct) : DEFAULT_GROUP_DEPOSIT_PERCENT;
  return Math.round(total * share / 100);
}

const rateOf = (row: PricingPriceRow, rate: 'rr' | 'nr'): number => (rate === 'nr' ? row.nr : row.rr);

/** The client keys its selection by experience id + option. */
const lineKey = (item: PricingItem): string => item.id + '::' + (item.variant || '');

/**
 * Per-person park entry. It follows the printed admission rows when they exist
 * (RR 400/275, NR 550/325); the flat settings values are only a fallback for a
 * database without them.
 */
function entryPrices(rate: 'rr' | 'nr', priceRows: PricingPriceRow[], settings: PricingSettings): { adult: number; child: number } {
  const admission = (needle: string) =>
    priceRows.find((r) => r.groupKey === 'admission' && r.label.toLowerCase().includes(needle));
  const adultRow = admission('12 years');
  const childRow = admission('6 to 11');
  return {
    adult: adultRow ? rateOf(adultRow, rate) : settings.entryAdult,
    child: childRow ? rateOf(childRow, rate) : settings.entryChild,
  };
}

/** The student price list (school groups) and the expo deals already include the entrance fee. */
function entryIncludedFamily(items: PricingItem[], products: Product[]): string | undefined {
  const familyOf = (id: string) => (isProductId(id) ? products.find((p) => p.key === productKeyOf(id))?.family : undefined);
  return items.map((i) => familyOf(i.id)).find((f) => f && ENTRY_INCLUDED_FAMILIES.has(f));
}

function parkEntryLine(input: PricingInput, amount: number, includedFamily: string | undefined): PricedLine {
  const what = includedFamily === 'student'
    ? 'included with the student rate'
    : includedFamily ? 'included with the expo deal' : partyLabel(input.adults, input.kids);
  return {
    experienceId: null,
    variant: '',
    label: 'Park entry · ' + what,
    productKey: null,
    time: null,
    adults: input.adults,
    kids: input.kids,
    units: 0,
    amount,
  };
}

/** Every product line must be an active product, for this rate, on this visit date. */
function bookedProducts(items: PricingItem[], products: Product[], input: PricingInput): { item: PricingItem; product: Product }[] {
  const productById = new Map(products.map((p) => [p.key, p]));
  return items.map((item) => {
    const p = productById.get(productKeyOf(item.id));
    if (!p || !p.active) throw new BadRequestException(`Unknown product "${item.id}"`);
    if (p.rateOnly && p.rateOnly !== input.rate) throw new BadRequestException(`"${p.name}" is for ${p.rateOnly === 'rr' ? 'residents' : 'visitors'} only`);
    if (input.visitDate && !productValidOn(p, input.visitDate)) {
      throw new BadRequestException(`"${p.name}" is valid for visits from ${String(p.validFrom ?? '').slice(0, 10) || 'now'} to ${String(p.validTo ?? '').slice(0, 10) || 'further notice'} only`);
    }
    return { item, product: p };
  });
}

/**
 * Every experience line must name a known experience and, when it has one, a
 * known option. The client keys its selection by experience id + option, so
 * duplicates can never be legitimate. (The Explorer Pass counts DISTINCT
 * experiences, so two options of the same experience are fine but never
 * inflate the discount.)
 */
function bookedExperiences(
  items: PricingItem[],
  byId: ReadonlyMap<string, PricingExperience>,
  priceRows: PricingPriceRow[],
): { item: PricingItem; exp: PricingExperience }[] {
  const seen = new Set<string>();
  return items.map((item) => {
    const key = lineKey(item);
    if (seen.has(key)) {
      throw new BadRequestException(`Duplicate experience "${item.id}" in items`);
    }
    seen.add(key);
    const exp = byId.get(item.id);
    if (!exp) {
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
    return { item, exp };
  });
}

function experienceLine(exp: PricingExperience, item: PricingItem, rate: 'rr' | 'nr', priceRows: PricingPriceRow[]): PricedLine {
  if (exp.priceMode === 'entry' || exp.priceMode === 'kiosk') {
    throw new BadRequestException(
      `Experience "${item.id}" is included with park entry and cannot be booked as a paid item`,
    );
  }

  const row = item.variant
    ? priceRows.find((r) => r.groupKey === exp.id && r.label === item.variant)
    : undefined;
  const price = row ? rateOf(row, rate) : priceFor(exp, rate);
  const a = item.adults || 0;
  const k = item.kids || 0;
  const u = item.units || 0;
  const flat = exp.priceMode === 'flat';
  const amount = flat ? price * u : price * a + Math.round(price * CHILD_SHARE) * k;
  const q = flat
    ? u + ' × ' + (exp.flatLabel ? exp.flatLabel.replace('/', '').trim() : 'unit')
    : partyLabel(a, k);

  return {
    experienceId: exp.id,
    productKey: null,
    variant: item.variant || '',
    label: exp.name + (item.variant ? ' · ' + item.variant : '') + ' · ' + q + (item.time ? ' · ' + item.time : ''),
    time: item.time || null,
    adults: a,
    kids: k,
    units: u,
    amount,
  };
}

function productLine(p: Product, item: PricingItem, rate: 'rr' | 'nr'): PricedLine {
  const a = item.adults || 0;
  const k = item.kids || 0;
  const u = p.mode === 'flat' ? Math.max(1, item.units || 0) : 0;
  const amount = productAmount(p, rate, a, k, u);
  const q = p.mode === 'flat' ? `${u} × ${p.family === 'cine' ? 'film' : 'unit'}` : partyLabel(a, k);
  return { experienceId: null, productKey: p.key, variant: '', label: p.name + ' · ' + q, time: null, adults: a, kids: k, units: u, amount };
}

/** Adventure, per-person lines that cost something: what the Explorer Pass counts. */
const countsForExplorerPass = (exp: PricingExperience, line: PricedLine): boolean =>
  exp.categoryId === 'adventure' && exp.priceMode === 'pp' && line.amount > 0;

/** The Explorer Pass discount over the priced experience lines. */
export function explorerPass(priced: { exp: PricingExperience; line: PricedLine }[]): { discount: number; advCount: number } {
  const qualifying = priced.filter(({ exp, line }) => countsForExplorerPass(exp, line));
  const advCount = new Set(qualifying.map(({ exp }) => exp.id)).size;
  const advSubtotal = qualifying.reduce((sum, { line }) => sum + line.amount, 0);
  const discount = advCount >= EXPLORER_PASS_MIN_EXPERIENCES ? Math.round(advSubtotal * EXPLORER_PASS_RATE) : 0;
  return { discount, advCount };
}

export function computeBooking(
  experiences: PricingExperience[],
  settings: PricingSettings,
  input: PricingInput,
  priceRows: PricingPriceRow[] = [],
  products: Product[] = [],
): PricedBooking {
  const byId = new Map(experiences.map((e) => [e.id, e]));

  const includedFamily = entryIncludedFamily(input.items, products);
  const perHead = entryPrices(input.rate, priceRows, settings);
  const entry = includedFamily ? 0 : perHead.adult * input.adults + perHead.child * input.kids;

  // Validated in this order (products, then experiences), so the first problem reported is stable.
  const productsBooked = bookedProducts(input.items.filter((i) => isProductId(i.id)), products, input);
  const experiencesBooked = bookedExperiences(input.items.filter((i) => !isProductId(i.id)), byId, priceRows);

  // The guest's on-screen summary lists experiences in catalog order
  // (Frontend booking.ts filters catalog.ACTS), while the request carries them in
  // tap order; sort so the persisted lines and the printed receipt agree.
  const ordered = [...experiencesBooked].sort((x, y) => x.exp.sortOrder - y.exp.sortOrder);
  const pricedExperiences = ordered.map(({ item, exp }) => ({ exp, line: experienceLine(exp, item, input.rate, priceRows) }));
  const productLines = productsBooked.map(({ item, product }) => productLine(product, item, input.rate));

  const lines: PricedLine[] = [parkEntryLine(input, entry, includedFamily), ...pricedExperiences.map((x) => x.line), ...productLines];
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const { discount, advCount } = explorerPass(pricedExperiences);
  return {
    lines,
    entry,
    subtotal,
    discount,
    total: subtotal - discount,
    advCount,
  };
}
