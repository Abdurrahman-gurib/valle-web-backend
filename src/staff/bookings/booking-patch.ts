import type { AdjustmentKind, PricingItem } from '../../bookings/pricing';
import { CouponsService } from '../../coupons/coupons.service';
import { isoDay } from '../../common/park-time';
import type { Booking, BookingAuditAction, BookingAuditChanges, BookingLine } from '../../entities';
import type { BookingStatus } from './dto/list-bookings.dto';
import type { UpdateBookingDto } from './dto/update-booking.dto';

/**
 * Pure rules of a booking edit: which fields were really sent, which of them
 * really change (the audit trail), which ones move money or places, and how
 * the experience lines are re-read for re-pricing.
 */

/** The editable subset of a booking, normalised (trimmed) and fully typed. */
export interface BookingPatch {
  visitDate?: string;
  slot?: 'morning' | 'afternoon';
  adults?: number;
  kids?: number;
  infants?: number;
  rate?: 'rr' | 'nr';
  guestName?: string;
  phone?: string;
  email?: string;
  nationality?: string;
  payMode?: 'gate' | 'online';
  status?: BookingStatus;
  staffNote?: string;
  /** JSON of the requested experience lines (compared as text for the audit trail). */
  items?: string;
  adjustmentKind?: AdjustmentKind;
  adjustmentValue?: number;
  adjustmentNote?: string;
  couponCode?: string;
}

export type PatchField = keyof BookingPatch;

/** One requested line of a patch's `items`, as normalizePatch wrote it. */
export interface PatchItem {
  id: string;
  variant?: string;
  adults?: number;
  kids?: number;
  units?: number;
  time?: string;
}

/** Editing any of these re-prices the booking from its own experience lines. */
export const MONEY_FIELDS = ['adults', 'kids', 'infants', 'rate', 'items', 'adjustmentKind', 'adjustmentValue', 'adjustmentNote', 'couponCode'] as const;

/** Changing any of these needs room in the (new) slot. */
export const PLACE_FIELDS = ['visitDate', 'slot', 'adults', 'kids', 'infants', 'status'] as const;

/**
 * Keeps only the fields the operator actually sent, trimmed. Absent keys are
 * left off entirely, so "not sent" stays distinct from "cleared".
 */
export function normalizePatch(dto: UpdateBookingDto): BookingPatch {
  const patch: BookingPatch = {};
  if (dto.visitDate !== undefined) {
    patch.visitDate = dto.visitDate.trim().slice(0, 10);
  }
  if (dto.slot !== undefined) patch.slot = dto.slot;
  if (dto.adults !== undefined) patch.adults = dto.adults;
  if (dto.kids !== undefined) patch.kids = dto.kids;
  if (dto.infants !== undefined) patch.infants = dto.infants;
  if (dto.rate !== undefined) patch.rate = dto.rate;
  if (dto.guestName !== undefined) patch.guestName = dto.guestName.trim();
  if (dto.phone !== undefined) patch.phone = dto.phone.trim();
  if (dto.email !== undefined) patch.email = dto.email.trim();
  if (dto.nationality !== undefined) {
    patch.nationality = dto.nationality.trim();
  }
  if (dto.payMode !== undefined) patch.payMode = dto.payMode;
  if (dto.status !== undefined) patch.status = dto.status;
  if (dto.staffNote !== undefined) patch.staffNote = dto.staffNote.trim();
  if (dto.items !== undefined) {
    patch.items = JSON.stringify(dto.items.map((i) => ({ id: i.id, variant: i.variant || undefined, adults: i.adults || 0, kids: i.kids || 0, units: i.units || 0, time: i.time || undefined })));
  }
  if (dto.adjustmentKind !== undefined) patch.adjustmentKind = dto.adjustmentKind;
  if (dto.adjustmentValue !== undefined) patch.adjustmentValue = dto.adjustmentValue;
  if (dto.adjustmentNote !== undefined) patch.adjustmentNote = dto.adjustmentNote.trim();
  if (dto.couponCode !== undefined) patch.couponCode = CouponsService.normalise(dto.couponCode);
  return patch;
}

/** The fields present in a patch. */
export const patchFields = (patch: BookingPatch): PatchField[] => Object.keys(patch) as PatchField[];

/** The stored value of an editable field, in the same shape the patch carries. */
export function currentValue(b: Booking, field: PatchField): string | number {
  switch (field) {
    case 'visitDate':
      return isoDay(b.visitDate);
    case 'slot':
      return b.slot;
    case 'adults':
      return b.adults;
    case 'kids':
      return b.kids;
    case 'infants':
      return b.infants ?? 0;
    case 'rate':
      return b.rate;
    case 'guestName':
      return b.guestName;
    case 'phone':
      return b.phone;
    case 'email':
      return b.email;
    case 'nationality':
      return b.nationality;
    case 'payMode':
      return b.payMode;
    case 'status':
      return b.status;
    case 'staffNote':
      return b.staffNote;
    case 'items':
      // compared as the requested list; the stored lines are re-read in reprice()
      return '';
    case 'adjustmentKind':
      return b.adjustmentKind ?? 'none';
    case 'adjustmentValue':
      return b.adjustmentValue ?? 0;
    case 'adjustmentNote':
      return b.adjustmentNote ?? '';
    case 'couponCode':
      return b.couponCode ?? '';
  }
}

/**
 * `{ field: { from, to } }` for the fields that really move. Only those are
 * audited, so a re-submitted form does not fill the trail with no-ops.
 */
export function auditedChanges(b: Booking, patch: BookingPatch): BookingAuditChanges {
  const changes: BookingAuditChanges = {};
  for (const field of patchFields(patch)) {
    const from = currentValue(b, field);
    const to = patch[field];
    if (to !== undefined && from !== to) changes[field] = { from, to };
  }
  return changes;
}

export const touchesMoney = (changes: BookingAuditChanges): boolean => MONEY_FIELDS.some((field) => field in changes);
export const touchesPlaces = (changes: BookingAuditChanges): boolean => PLACE_FIELDS.some((field) => field in changes);

export function applyPatch(b: Booking, patch: BookingPatch): void {
  if (patch.visitDate !== undefined) b.visitDate = patch.visitDate;
  if (patch.slot !== undefined) b.slot = patch.slot;
  if (patch.adults !== undefined) b.adults = patch.adults;
  if (patch.kids !== undefined) b.kids = patch.kids;
  if (patch.infants !== undefined) b.infants = patch.infants;
  if (patch.rate !== undefined) b.rate = patch.rate;
  if (patch.guestName !== undefined) b.guestName = patch.guestName;
  if (patch.phone !== undefined) b.phone = patch.phone;
  if (patch.email !== undefined) b.email = patch.email;
  if (patch.nationality !== undefined) b.nationality = patch.nationality;
  if (patch.payMode !== undefined) b.payMode = patch.payMode;
  if (patch.status !== undefined) b.status = patch.status;
  if (patch.staffNote !== undefined) b.staffNote = patch.staffNote;
  // items and adjustments are applied by reprice(), which owns the money.
}

/** `edit` unless the operator touched nothing but the status or the note. */
export function auditAction(changed: string[]): BookingAuditAction {
  if (changed.length === 1 && changed[0] === 'status') return 'status';
  if (changed.length === 1 && changed[0] === 'staffNote') return 'note';
  return 'edit';
}

/** The patch's requested lines, or null when it did not send any. */
export const patchItems = (patch: BookingPatch): PatchItem[] | null =>
  patch.items !== undefined ? (JSON.parse(patch.items) as PatchItem[]) : null;

/**
 * What to price: the requested lines, or the booking's own paid lines
 * (experiences and products; the park-entry row is regenerated). An item sent
 * without a time keeps the time its line already had (desk and guest editors
 * do not pick times).
 */
export function repricingItems(patch: BookingPatch, existing: BookingLine[]): PricingItem[] {
  const requested = patchItems(patch);
  if (requested) {
    return requested.map((i) => ({
      ...i,
      time: i.time ?? existing.find((l) => l.experienceId === i.id && (l.variant || '') === (i.variant || ''))?.sessionTime ?? undefined,
    }));
  }
  return existing.map((line) => ({
    // The caller's query already excluded the null (park entry) rows.
    id: line.experienceId ?? ('product:' + (line.productKey ?? '')),
    variant: line.variant || undefined,
    adults: line.adults,
    kids: line.kids,
    units: line.units,
    time: line.sessionTime ?? undefined,
  }));
}

/** What the capacity check counts: the requested lines, or the booking's experience lines. */
export function placesItems(patch: BookingPatch, lines: BookingLine[]): PatchItem[] {
  return patchItems(patch) ?? lines.flatMap((l) =>
    l.experienceId ? [{ id: l.experienceId, adults: l.adults, kids: l.kids, units: l.units, time: l.sessionTime ?? undefined }] : [],
  );
}

/** A party: adults and children. */
export interface Party { adults: number; kids: number }

/** A line's head-count, the part of a pricing item a party change can move. */
interface Counted { adults?: number; kids?: number; units?: number }

/**
 * Fits experience lines to a new party, so a smaller party is never charged
 * for guests who are no longer coming:
 *  - a count that covered the whole of its side of the old party (all the
 *    adults, all the children) follows the new party;
 *  - any other count is clamped to the new party;
 *  - per-unit lines (buggies, packages) are left alone;
 *  - a line left with nobody on it is dropped.
 * 2 adults + 2 children → 3 + 1: a whole-party zipline becomes 3 + 1, a
 * Pirate Ship for the 2 children becomes 1 child.
 */
export function fitLinesToParty<T extends Counted>(lines: T[], from: Party, to: Party): T[] {
  const fit = (n: number | undefined, old: number, next: number): number => {
    const v = n ?? 0;
    if (v <= 0) return 0;
    if (old > 0 && v === old) return next;
    return Math.min(v, next);
  };
  return lines
    .map((l) => ((l.units ?? 0) > 0 && !(l.adults ?? 0) && !(l.kids ?? 0)
      ? l
      : { ...l, adults: fit(l.adults, from.adults, to.adults), kids: fit(l.kids, from.kids, to.kids) }))
    .filter((l) => (l.adults ?? 0) + (l.kids ?? 0) + (l.units ?? 0) > 0);
}

/** Lines whose counts differ between two lists, for the trail: "zipline 2+2 → 3+1". */
export function lineCountChanges(before: PatchItem[], after: PatchItem[]): string {
  const key = (l: PatchItem) => l.id + '::' + (l.variant ?? '');
  const count = (l?: PatchItem) => (l ? `${l.adults ?? 0}+${l.kids ?? 0}` : 'removed');
  const out: string[] = [];
  for (const b of before) {
    const a = after.find((x) => key(x) === key(b));
    if (!a || (a.adults ?? 0) !== (b.adults ?? 0) || (a.kids ?? 0) !== (b.kids ?? 0)) out.push(`${b.id}${b.variant ? ` (${b.variant})` : ''} ${count(b)} → ${count(a)}`);
  }
  return out.join(', ');
}

/** The booking's paid lines as patch items (park entry excluded: it is regenerated). */
export function linesAsItems(lines: BookingLine[]): PatchItem[] {
  return lines.flatMap((l) => (l.experienceId || l.productKey
    ? [{
      id: l.experienceId ?? 'product:' + (l.productKey ?? ''),
      variant: l.variant || undefined,
      adults: l.adults, kids: l.kids, units: l.units,
      time: l.sessionTime ?? undefined,
    }]
    : []));
}
