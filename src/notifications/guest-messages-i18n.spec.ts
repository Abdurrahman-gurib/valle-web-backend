import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import type { Booking, BookingLine } from '../entities';
import { TicketService } from '../tickets/ticket.service';
import { renderReceiptPdf } from '../tickets/receipt-pdf';
import { GuestMessagingService } from './guest-messaging.service';
import { MailService } from './mail.service';
import { WhatsAppService } from './whatsapp.service';

/** The guest messages in the guest's language: English, French and Arabic (right to left). */
const config = (vars: Record<string, string> = {}) => ({ get: (k: string) => vars[k] }) as unknown as ConfigService;
const tickets = new TicketService(config({ JWT_SECRET: 'x'.repeat(40), SITE_URL: 'https://example.test' }), {} as Repository<Booking>, {} as Repository<BookingLine>, {} as never, {} as never);
const svc = new GuestMessagingService(new MailService(config()), new WhatsAppService(config()), tickets, {} as never, {} as never, config());
const lines = [{ label: 'Zipline Adventures · The Signature', amount: 4700 }] as unknown as BookingLine[];
const booking = (lang: string) => ({
  id: 'b1', refCode: 'VAL-1234-26', visitDate: '2099-10-02', slot: 'morning', guestName: 'Asha Ramgoolam',
  email: 'asha@example.com', phone: '+230 5292 8841', adults: 2, kids: 1, infants: 0, rate: 'rr', payMode: 'gate',
  subtotal: 6200, discount: 0, total: 6200, paidAmount: 0, depositAmount: 0, status: 'confirmed', lang,
}) as unknown as Booking;

describe('guest messages per language', () => {
  it.each([
    ['en', 'Your VALLÉ ticket VAL-1234-26 · Friday, 2 October 2099', ['Your ticket is ready', 'To pay on arrival: Rs 6,200', '2 adults and 1 child', 'https://example.test/ticket/']],
    ['fr', 'Votre billet VALLÉ VAL-1234-26 · vendredi 2 octobre 2099', ['Votre billet est prêt', "À régler à l'arrivée", '2 adultes et 1 enfant', 'https://example.test/fr/ticket/', 'Signer les décharges']],
    ['ar', 'تذكرتكم في VALLÉ VAL-1234-26 · الجمعة، 2 أكتوبر 2099', ['تذكرتكم جاهزة', 'يُدفع عند الوصول', '2 بالغان و1 طفل', 'https://example.test/ar/ticket/', 'Zipline Adventures · The Signature']],
  ])('ticket e-mail in %s', (lang, subject, phrases) => {
    const m = svc.renderTicketEmail(booking(lang), lines);
    expect(m.subject).toBe(subject);
    for (const p of phrases) expect(m.html + m.text).toContain(p);
    if (lang === 'ar') {
      expect(m.html).toContain('<html lang="ar" dir="rtl">');
      expect(m.html).toContain('dir="rtl"');
      expect(m.html).toContain('Tahoma');
      expect(m.html).toContain('text-align:left');
    } else if (lang === 'fr') {
      expect(m.html).toContain('<html lang="fr" dir="ltr">');
    } else {
      expect(m.html.startsWith('<!doctype html><html><body style="margin:0;background:#F7F3FF;font-family:Arial,Helvetica,sans-serif;color:#340057">')).toBe(true);
    }
  });

  it.each([
    ['en', 'Tomorrow at VALLÉ · VAL-1234-26', ['See you tomorrow at VALLÉ Advenature™ Park, Asha!', 'Rs 6,200 to pay on arrival (cash or card).', '1 of 3 still unsigned']],
    ['fr', 'Demain au VALLÉ · VAL-1234-26', ['À demain au VALLÉ Advenature™ Park, Asha !', "à régler à l'arrivée (espèces ou carte).", '2 sur 3 pas encore signées']],
    ['ar', 'غدًا في VALLÉ · VAL-1234-26', ['نراكم غدًا في VALLÉ Advenature™ Park يا Asha!', 'تُدفع عند الوصول', '2 من 3 لم تُوقَّع بعد']],
  ])('reminder in %s', (lang, subject, phrases) => {
    const signed = lang === 'en' ? 2 : 1;
    const m = svc.renderReminderEmail(booking(lang), '', { signed, required: 3 });
    expect(m.subject).toBe(subject);
    for (const p of phrases) expect(m.text).toContain(p);
    expect(svc.reminderWhatsApp(booking(lang)).text).toBe(svc.reminderText(booking(lang)));
    if (lang === 'ar') expect(m.html).toContain('dir="rtl"');
    else expect(m.html).not.toContain('dir="rtl"');
  });

  it.each([
    ['en', 'Sign your safety waivers · VAL-1234-26', 'by Thursday, 1 October 2099 evening'],
    ['fr', 'Signez vos décharges de sécurité · VAL-1234-26', "d'ici le jeudi 1 octobre 2099 au soir"],
    ['ar', 'وقّعوا نماذج إخلاء المسؤولية · VAL-1234-26', 'قبل مساء الخميس'],
  ])('waiver nudge in %s', (lang, subject, deadline) => {
    const m = svc.renderWaiverLinkEmail(booking(lang), { signed: 0, required: 3 });
    expect(m.subject).toBe(subject);
    expect(m.text).toContain(deadline);
    expect(m.html).toContain(lang === 'en' ? '/waiver/' : `/${lang}/waiver/`);
    expect(m.html.includes('dir="rtl"')).toBe(lang === 'ar');
  });

  it('keeps the WhatsApp template parameters English, translates the free text', () => {
    const msg = svc.ticketWhatsApp(booking('fr'));
    expect(msg.params).toEqual(['Asha', 'VAL-1234-26', 'Friday, 2 October 2099, morning arrival, 09:00 to 12:00', '2 adults and 1 child', 'Rs 6,200 to pay on arrival']);
    expect(msg.text).toContain('Bonjour Asha, votre réservation au VALLÉ Advenature™ Park est confirmée !');
  });

  it('falls back to English for a booking without a known language', () => {
    expect(svc.renderTicketEmail(booking('xx'), lines).subject).toBe('Your VALLÉ ticket VAL-1234-26 · Friday, 2 October 2099');
  });

  it.each(['en', 'fr', 'de', 'ar', 'ru', 'hi'])('renders the receipt PDF in %s', async (lang) => {
    const pdf = await renderReceiptPdf({ ...booking(lang), paidAmount: 1000, paidAt: '2026-10-01', paymentMethod: 'cash', status: 'postponed' } as unknown as Booking, lines, { siteUrl: 'https://x', lang });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
