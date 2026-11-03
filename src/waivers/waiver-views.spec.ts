import { BadRequestException } from '@nestjs/common';
import { Waiver, type Booking } from '../entities';
import type { SignWaiverDto } from './waiver.dto';
import { newWaiverRecord, signerFor, stopCount, toGateWaiver, toHistory } from './waiver-views';
import { WAIVER_TERMS_VERSION } from './waiver-rules';

const dto = (over: Partial<SignWaiverDto> = {}): SignWaiverDto => ({
  participantName: '  Asha   Rahman ', birthDate: '1990-04-12', heightCm: 165, weightKg: 60, phone: ' 5 ', nationality: ' MU ',
  emergencyName: ' Omar ', emergencyPhone: ' 6 ', declarations: { terms: true, health: true, consent: true }, signature: 'data:image/png;base64,x',
  ...over,
} as SignWaiverDto);

describe('waiver views', () => {
  it('works out who signs, and refuses impossible ages or a minor without a guardian', () => {
    expect(signerFor(dto(), '2026-10-02')).toEqual({ name: 'Asha Rahman', isMinor: false, guardian: '' });
    expect(signerFor(dto({ birthDate: '2015-01-01', guardianName: ' Omar ' }), '2026-10-02')).toEqual({ name: 'Asha Rahman', isMinor: true, guardian: 'Omar' });
    expect(() => signerFor(dto({ birthDate: '2015-01-01' }), '2026-10-02')).toThrow(new BadRequestException('A parent or guardian must sign for a participant under 18'));
    expect(() => signerFor(dto({ birthDate: '1800-01-01' }), '2026-10-02')).toThrow('Please check the date of birth');
    expect(() => signerFor(dto({ birthDate: '2027-01-01' }), '2026-10-02')).toThrow('Please check the date of birth');
  });

  it('records the signature trimmed, the guardian signing for a minor', () => {
    const b = { id: 'b1', groupKind: 'school' } as Booking;
    const row = newWaiverRecord(dto({ groupParticipants: [' Ann ', '', 'Bob'] }), b, { name: 'Kid', isMinor: true, guardian: 'Omar' }, 2, { ip: '1'.repeat(80), userAgent: 'ua' });
    expect(row).toMatchObject({
      version: 2, bookingId: 'b1', participantName: 'Kid', guardianName: 'Omar', signedBy: 'Omar', phone: '5', nationality: 'MU', emergencyName: 'Omar',
      groupParticipants: ['Ann', 'Bob'], marketingConsent: false, lang: 'en', termsVersion: WAIVER_TERMS_VERSION, ip: '1'.repeat(64),
    });
    expect(newWaiverRecord(dto(), { id: 'b2', groupKind: null } as Booking, { name: 'Asha', isMinor: false, guardian: 'x' }, 1, { ip: '', userAgent: '' }))
      .toMatchObject({ groupParticipants: null, guardianName: '', signedBy: 'Asha' });
  });

  it('reads a waiver for the gate with its activity flags', () => {
    const w = Object.assign(new Waiver(), { id: 'w1', participantName: 'Kid', birthDate: '2018-06-01', heightCm: 110, weightKg: 25, signedAt: new Date('2026-10-01T08:00:00Z'), signaturePng: 'png', version: null });
    const g = toGateWaiver(w, '2026-10-02', [{ id: 'zipline', name: 'Zipline', limits: { minAge: 8, minHeightCm: 120 } }]);
    expect(g).toMatchObject({ age: 8, birthDate: '2018-06-01', signature: 'png', signedAt: '2026-10-01T08:00:00.000Z', version: 1 });
    expect(g.flags).toEqual([{ level: 'stop', activity: 'Zipline', message: '110 cm, minimum 120 cm' }]);
    expect(stopCount([g, g])).toBe(2);
  });

  it('lists superseded signatures', () => {
    const old = Object.assign(new Waiver(), { id: 'w0', participantName: 'Kid', version: 1, signedAt: new Date('2026-10-01T08:00:00Z'), supersededAt: new Date('2026-10-01T09:00:00Z') });
    expect(toHistory([old])).toEqual([{ id: 'w0', participantName: 'Kid', version: 1, signedAt: '2026-10-01T08:00:00.000Z', supersededAt: '2026-10-01T09:00:00.000Z' }]);
  });
});
