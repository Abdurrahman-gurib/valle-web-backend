import { Booking, BookingLine } from '../../entities';
import {
  applyPatch, auditAction, auditedChanges, normalizePatch, patchFields, placesItems, repricingItems, touchesMoney, touchesPlaces,
} from './booking-patch';
import type { UpdateBookingDto } from './dto/update-booking.dto';

const booking = (over: Partial<Booking> = {}): Booking => Object.assign(new Booking(), {
  visitDate: '2026-10-02', slot: 'morning', adults: 2, kids: 1, rate: 'rr', guestName: 'Asha', phone: '5', email: 'a@x', nationality: 'MU',
  payMode: 'gate', status: 'confirmed', staffNote: '', adjustmentKind: 'none', adjustmentValue: 0, adjustmentNote: '', couponCode: '',
}, over);

const line = (over: Partial<BookingLine>): BookingLine => Object.assign(new BookingLine(), { experienceId: null, productKey: null, variant: '', adults: 0, kids: 0, units: 0, sessionTime: null }, over);

describe('booking patch', () => {
  it('keeps only what was sent, trimmed and normalised', () => {
    const patch = normalizePatch({ visitDate: ' 2026-10-05T00:00 ', guestName: ' Asha R ', couponCode: ' summer 10 ', items: [{ id: 'zipline', adults: 2 }] } as UpdateBookingDto);
    expect(patch).toEqual({
      visitDate: '2026-10-05', guestName: 'Asha R', couponCode: 'SUMMER10',
      items: JSON.stringify([{ id: 'zipline', adults: 2, kids: 0, units: 0 }]),
    });
    expect(patchFields(normalizePatch({}))).toEqual([]);
  });

  it('audits only the fields that really move', () => {
    const b = booking();
    const changes = auditedChanges(b, normalizePatch({ guestName: 'Asha', adults: 3, staffNote: ' VIP ' } as UpdateBookingDto));
    expect(changes).toEqual({ adults: { from: 2, to: 3 }, staffNote: { from: '', to: 'VIP' } });
    expect(touchesMoney(changes)).toBe(true);
    expect(touchesPlaces(changes)).toBe(true);
    expect(touchesMoney({ staffNote: { from: '', to: 'x' } })).toBe(false);
    expect(touchesPlaces({ email: { from: '', to: 'x' } })).toBe(false);
  });

  it('names the audit action after the single field touched', () => {
    expect(auditAction(['status'])).toBe('status');
    expect(auditAction(['staffNote'])).toBe('note');
    expect(auditAction(['status', 'staffNote'])).toBe('edit');
    expect(auditAction(['adults'])).toBe('edit');
  });

  it('applies the non-money fields only', () => {
    const b = booking();
    applyPatch(b, { slot: 'afternoon', status: 'cancelled', adjustmentKind: 'foc', items: '[]' });
    expect(b.slot).toBe('afternoon');
    expect(b.status).toBe('cancelled');
    expect(b.adjustmentKind).toBe('none');
  });

  it('re-prices from the stored lines, or the requested ones keeping their session time', () => {
    const existing = [line({ experienceId: 'swing', adults: 2, sessionTime: '10:30' }), line({ productKey: 'combo:0', adults: 2 })];
    expect(repricingItems({}, existing)).toEqual([
      { id: 'swing', variant: undefined, adults: 2, kids: 0, units: 0, time: '10:30' },
      { id: 'product:combo:0', variant: undefined, adults: 2, kids: 0, units: 0, time: undefined },
    ]);
    const patch = normalizePatch({ items: [{ id: 'swing', adults: 3 }, { id: 'luge', adults: 1, time: '11:00' }] } as UpdateBookingDto);
    expect(repricingItems(patch, existing)).toEqual([
      { id: 'swing', adults: 3, kids: 0, units: 0, time: '10:30' },
      { id: 'luge', adults: 1, kids: 0, units: 0, time: '11:00' },
    ]);
  });

  it('counts places on the experience lines only', () => {
    const lines = [line({ amount: 800 }), line({ experienceId: 'zipline', adults: 2, sessionTime: null })];
    expect(placesItems({}, lines)).toEqual([{ id: 'zipline', adults: 2, kids: 0, units: 0, time: undefined }]);
    expect(placesItems({ items: '[{"id":"quad","adults":1}]' }, lines)).toEqual([{ id: 'quad', adults: 1 }]);
  });
});
