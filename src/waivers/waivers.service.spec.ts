import { BadRequestException, ConflictException } from '@nestjs/common';
import { ageOn, flagsFor, parseAgeLabel, parseLimitsSetting } from './waiver-rules';
import { WaiversService, parkToday } from './waivers.service';
import type { SignWaiverDto } from './waiver.dto';
import { renderWaiverPdf } from './waiver-pdf';
import { WhatsAppService } from '../notifications/whatsapp.service';

describe('waiver PDF and WhatsApp copy', () => {
  it('renders a PDF with the clauses in the language read, and English for Arabic', async () => {
    const b = { refCode: 'VAL-1111-26', visitDate: '2026-10-02', slot: 'morning' } as never;
    const base = {
      id: 'w1', participantName: 'Eric Fransen', birthDate: '1970-09-22', heightCm: 180, weightKg: 82, isMinor: false, guardianName: '',
      address: 'Lux Le Morne', email: 'e@example.be', phone: '+32 477 59 26 59', nationality: 'Belgium', idNumber: '', marketingConsent: true,
      emergencyName: 'Annemie', emergencyPhone: '+32 479 09 80 61', medicalNotes: '',
      signaturePng: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      signedBy: 'Eric Fransen', termsVersion: 'VAL-DISCLAIMER-2026-09-30', ip: '1.2.3.4', signedAt: new Date('2026-09-30T06:09:19Z'),
    };
    for (const lang of ['en', 'fr', 'ar']) {
      const pdf = await renderWaiverPdf({ ...base, lang } as never, b, { siteUrl: 'https://example.test' });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(5000);
    }
  });

  it('builds a document template payload with the PDF as header', () => {
    const wa = new WhatsAppService({ get: (k: string) => (k === 'D360_API_KEY' ? 'key' : undefined) } as never);
    const p = wa.documentPayload('+23059086131', 'valle_waiver_copy', { link: 'https://x/a.pdf', filename: 'a.pdf', params: ['Eric', 'VAL-1'], ticketPath: 'VAL-1?t=abc', text: '' }) as { to: string; template: { components: { type: string; parameters: unknown[] }[] } };
    expect(p.to).toBe('23059086131');
    expect(p.template.components[0]).toEqual({ type: 'header', parameters: [{ type: 'document', document: { link: 'https://x/a.pdf', filename: 'a.pdf' } }] });
    expect(p.template.components[2].parameters).toEqual([{ type: 'text', text: 'VAL-1?t=abc' }]);
  });
});

describe('waiver rules', () => {
  it('reads the catalog age labels', () => {
    expect(parseAgeLabel('8+')).toEqual({ minAge: 8 });
    expect(parseAgeLabel('16+ DRIVE')).toEqual({ driveMinAge: 16 });
    expect(parseAgeLabel('3–12')).toEqual({ minAge: 3, maxAge: 12 });
    expect(parseAgeLabel('4+ W/ ADULT')).toEqual({ minAge: 4 });
    expect(parseAgeLabel('ALL AGES')).toEqual({});
  });

  it('counts age at the visit date, birthday included', () => {
    expect(ageOn('2018-10-01', '2026-10-01')).toBe(8);
    expect(ageOn('2018-10-02', '2026-10-01')).toBe(7);
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
  });

  it('flags age, driving and weight against the activities in the booking', () => {
    const acts = [
      { id: 'zipline', name: 'Zipline Adventures', limits: { minAge: 8 } },
      { id: 'quad', name: 'Quad', limits: { driveMinAge: 16 } },
      { id: 'bicycle', name: 'Bicycle Zipline', limits: { minAge: 10, maxWeightKg: 100 } },
    ];
    const kid = flagsFor({ birthDate: '2019-05-01', heightCm: 120, weightKg: 22 }, '2026-10-01', acts);
    expect(kid.map((f) => [f.level, f.activity])).toEqual([
      ['stop', 'Zipline Adventures'], ['check', 'Quad'], ['stop', 'Bicycle Zipline'],
    ]);
    const heavy = flagsFor({ birthDate: '1980-01-01', heightCm: 185, weightKg: 112 }, '2026-10-01', acts);
    expect(heavy).toEqual([{ level: 'stop', activity: 'Bicycle Zipline', message: '112 kg, maximum 100 kg' }]);
  });

  it('keeps only numeric limits from the settings row', () => {
    expect(parseLimitsSetting('{"zipline":{"maxWeightKg":120,"note":"x"},"bad":5}')).toEqual({ zipline: { maxWeightKg: 120 } });
    expect(parseLimitsSetting('not json')).toEqual({});
  });
});

// ---------------------------------------------------------------- service

const inDays = (n: number) => {
  const d = new Date(parkToday() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function build(booking: Record<string, unknown>, existing: Record<string, unknown>[] = []) {
  const b = { id: 'b1', refCode: 'VAL-1111-26', guestName: 'Aisha Rahman', phone: '', visitDate: inDays(2), slot: 'morning', adults: 2, kids: 1, status: 'confirmed', payMode: 'gate', total: 5000, ...booking };
  const rows = [...existing];
  const saved: unknown[] = [];
  const audits: unknown[] = [];
  const waiverRepo = {
    find: jest.fn(async () => rows.map((r) => ({ signedAt: new Date(), ...r }))),
    count: jest.fn(async () => rows.length),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: Record<string, unknown>) => { saved.push(x); if (!x.id) rows.push({ ...x, id: 'w' + rows.length }); return x; }),
    createQueryBuilder: jest.fn(() => {
      let name = '';
      const qb = {
        where: () => qb,
        andWhere: (_: string, p: { name: string }) => { name = p.name; return qb; },
        getOne: async () => rows.find((r) => String(r.participantName).toLowerCase() === name.toLowerCase()) ?? null,
      };
      return qb;
    }),
  };
  const bookingRepo = {
    findOne: jest.fn(async () => b),
    findOneOrFail: jest.fn(async () => b),
    save: jest.fn(async (x: unknown) => x),
  };
  const tickets = { requireBooking: jest.fn(async () => b), waiverUrl: () => 'https://example.test/waiver/X' };
  const copies = { send: jest.fn(async () => ({ email: true, whatsapp: false })), pdf: jest.fn(async () => Buffer.from('%PDF')) };
  const svc = new WaiversService(
    tickets as never,
    copies as never,
    waiverRepo as never,
    bookingRepo as never,
    { find: jest.fn(async () => [{ experienceId: 'zipline' }]) } as never,
    { save: jest.fn(async (x: unknown) => audits.push(x)), create: (x: unknown) => x } as never,
    { find: jest.fn(async () => [{ id: 'zipline', name: 'Zipline Adventures', ageLabel: '8+' }]) } as never,
    { findOne: jest.fn(async () => null) } as never,
  );
  return { svc, b, saved, audits, rows, copies };
}

const dto = (over: Partial<SignWaiverDto> = {}): SignWaiverDto => ({
  participantName: 'Aisha Rahman',
  birthDate: '1990-04-12',
  heightCm: 165,
  weightKg: 60,
  emergencyName: 'Omar Rahman',
  emergencyPhone: '+971 50 123 4567',
  phone: '+32 477 59 26 59',
  nationality: 'Belgium',
  declarations: { terms: true, health: true, consent: true },
  signature: 'data:image/png;base64,' + 'A'.repeat(300),
  lang: 'ar',
  ...over,
});
const meta = { ip: '1.2.3.4', userAgent: 'test' };

describe('WaiversService.sign', () => {
  it('stores a waiver against the booking with the terms version and language', async () => {
    const { svc, saved } = build({});
    const view = await svc.sign('VAL-1111-26', 't', dto(), meta);
    expect(saved[0]).toMatchObject({ bookingId: 'b1', isMinor: false, signedBy: 'Aisha Rahman', lang: 'ar', termsVersion: 'VAL-DISCLAIMER-2026-09-30' });
    expect(view.required).toBe(3);
    expect(view.signed).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain('base64');
    expect(view.copy).toEqual({ email: true, whatsapp: false });
  });

  it('needs a guardian for a participant under 18', async () => {
    const { svc } = build({});
    await expect(svc.sign('VAL-1111-26', 't', dto({ participantName: 'Sami', birthDate: '2016-01-01' }), meta)).rejects.toBeInstanceOf(BadRequestException);
    const { svc: ok, saved } = build({});
    await ok.sign('VAL-1111-26', 't', dto({ participantName: 'Sami', birthDate: '2016-01-01', guardianName: 'Aisha Rahman' }), meta);
    expect(saved[0]).toMatchObject({ isMinor: true, signedBy: 'Aisha Rahman', guardianName: 'Aisha Rahman' });
  });

  it('stops at one waiver per participant, but lets a name sign again to correct it', async () => {
    const existing = ['A', 'B', 'C'].map((n, i) => ({ id: 'w' + i, participantName: n, isMinor: false }));
    const { svc } = build({}, existing);
    await expect(svc.sign('VAL-1111-26', 't', dto({ participantName: 'D' }), meta)).rejects.toBeInstanceOf(ConflictException);
    const { svc: again, saved } = build({}, existing);
    await again.sign('VAL-1111-26', 't', dto({ participantName: 'b' }), meta);
    expect(saved[0]).toMatchObject({ id: 'w1' });
  });

  it('refuses a past or cancelled booking', async () => {
    await expect(build({ visitDate: inDays(-1) }).svc.sign('VAL-1111-26', 't', dto(), meta)).rejects.toBeInstanceOf(ConflictException);
    await expect(build({ status: 'cancelled' }).svc.sign('VAL-1111-26', 't', dto(), meta)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('WaiversService.checkIn', () => {
  const staff = { id: 's1', email: 'gate@vallepark.com', name: 'Gate', role: 'agent' } as never;

  it('refuses while waivers are missing, and records an override', async () => {
    const { svc, b, audits } = build({ visitDate: parkToday() }, [{ id: 'w0', participantName: 'A', birthDate: '1990-01-01', heightCm: 170, weightKg: 70, isMinor: false }]);
    await expect(svc.checkIn('VAL-1111-26', {}, staff)).rejects.toThrow('2 of 3 waivers are not signed yet');
    await svc.checkIn('VAL-1111-26', { override: true, reason: 'paper waivers at the desk' }, staff);
    expect(b.status).toBe('arrived');
    expect(audits[0]).toMatchObject({ action: 'status', changes: { status: { from: 'confirmed', to: 'arrived' }, gateOverride: { to: 'paper waivers at the desk' } } });
  });

  it('flags a child under the zipline minimum age', async () => {
    const rows = [
      { id: 'w0', participantName: 'A', birthDate: '1990-01-01', heightCm: 170, weightKg: 70, isMinor: false },
      { id: 'w1', participantName: 'B', birthDate: '1992-01-01', heightCm: 160, weightKg: 55, isMinor: false },
      { id: 'w2', participantName: 'Kid', birthDate: inDays(-365 * 6), heightCm: 110, weightKg: 20, isMinor: true },
    ];
    const { svc } = build({ visitDate: parkToday() }, rows);
    const view = await svc.gateView('VAL-1111-26');
    expect(view.missing).toBe(0);
    expect(view.stops).toBe(1);
    await expect(svc.checkIn('VAL-1111-26', {}, staff)).rejects.toThrow('activity limit');
  });
});
