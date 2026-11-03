import type { Booking } from '../entities';
import { emailFrame, firstName, party, payLine, pinkButton, slotLabel, waiverDeadline } from './guest-messages';

const b = (over: Partial<Booking>): Booking => ({ guestName: 'Asha Rahman', adults: 2, kids: 1, total: 5000, paidAmount: 0, depositAmount: 0, ...over } as Booking);

describe('guest messages', () => {
  it('says what is still owed from the money actually recorded', () => {
    expect(payLine(b({}))).toBe('Rs 5,000 to pay on arrival');
    expect(payLine(b({ paidAmount: 5000 }))).toBe('Rs 5,000 paid');
    expect(payLine(b({ paidAmount: 1000 }))).toBe('Rs 1,000 paid, Rs 4,000 to pay on arrival');
    expect(payLine(b({ depositAmount: 1500, paidAmount: 500 }))).toBe('Rs 1,000 deposit due now, Rs 4,500 in all');
  });

  it('names the guest, the party and the slot', () => {
    expect(firstName(b({}))).toBe('Asha');
    expect(firstName(b({ guestName: ' Solo' }))).toBe(' Solo');
    expect(party(b({}))).toBe('2 adults and 1 child');
    expect(party(b({ adults: 1, kids: 0 }))).toBe('1 adult');
    expect(slotLabel('morning')).toBe('Morning arrival, 09:00 to 12:00');
    expect(slotLabel('afternoon')).toBe('Afternoon arrival, 12:00 to 15:30');
  });

  it('asks for waivers by the evening before, or before arrival when that has passed', () => {
    expect(waiverDeadline('2026-10-10', '2026-10-01')).toBe('by Friday, 9 October 2026 evening');
    expect(waiverDeadline('2026-10-02', '2026-10-01')).toBe('before you arrive');
    expect(waiverDeadline('2026-10-01', '2026-10-01')).toBe('before you arrive');
  });

  it('frames an e-mail body with the title, card style and footer', () => {
    const html = emailFrame({ title: 'Hello', titleSize: 24, cardStyle: ';font-size:15px', body: '    <p>x</p>', footer: 'Booking X' });
    expect(html.startsWith('<!doctype html><html><body style="margin:0;background:#F7F3FF;')).toBe(true);
    expect(html).toContain('<div style="font-size:24px;font-weight:900;font-style:italic;margin-top:6px">Hello</div>');
    expect(html).toContain('border-radius:0 0 18px 18px;font-size:15px">\n    <p>x</p>\n  </div>');
    expect(html.endsWith('margin:16px 0 0">Booking X</p>\n</div></body></html>')).toBe(true);
    expect(pinkButton('https://x', 'Go')).toBe('<a href="https://x" style="background:#FF3358;color:#FFFFFF;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px;display:inline-block">Go</a>');
  });
});
