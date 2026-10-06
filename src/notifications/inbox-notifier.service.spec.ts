import { ConfigService } from '@nestjs/config';
import type { JobApplication, JobVacancy, Quote } from '../entities';
import { InboxNotifierService } from './inbox-notifier.service';
import { MailService } from './mail.service';

const config = (vars: Record<string, string>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;
const build = (vars: Record<string, string>) => {
  const mail = new MailService(config(vars));
  return { svc: new InboxNotifierService(mail, config(vars)), mail };
};

const quote = {
  id: 'q1', name: 'Priya Naidoo', company: 'Acme Ltd', email: 'priya@acme.mu', phone: '+230 5111 2222',
  groupSize: '40', preferredDate: '2026-11-12', message: 'Team day with ziplines and lunch.',
} as Quote;
const vacancy = { id: 'v1', slug: 'zipline-guide', title: 'Zipline guide' } as JobVacancy;
const application = {
  id: 'a1', vacancyId: 'v1', fullName: 'Ariane Léger', email: 'ariane@example.com', phone: '', cvUrl: 'https://drive.example.com/cv.pdf',
  coverLetter: 'I would love to join.', yearsExperience: 3,
} as JobApplication;

describe('InboxNotifierService', () => {
  it('is off without SMTP_URL and never throws', async () => {
    const { svc } = build({});
    expect(svc.enabled).toBe(false);
    await expect(svc.notifyNewQuote(quote)).resolves.toBe(false);
    await expect(svc.notifyNewApplication(application, vacancy)).resolves.toBe(false);
  });

  it('tells the sales desk everything the group wrote', () => {
    const { subject, text } = build({ SMTP_URL: 'json' }).svc.renderQuote(quote);
    expect(subject).toBe('Quote request · Priya Naidoo (Acme Ltd) · 40 people');
    expect(text).toContain('priya@acme.mu');
    expect(text).toContain('Date:        2026-11-12');
    expect(text).toContain('Team day with ziplines and lunch.');
    expect(text).toContain('/staff (Quotes)');
  });

  it('tells HR about an application, with the CV link and letter', () => {
    const { subject, text } = build({ SMTP_URL: 'json' }).svc.renderApplication(application, vacancy);
    expect(subject).toBe('New application · Zipline guide · Ariane Léger');
    expect(text).toContain('Experience:  3 years');
    expect(text).toContain('https://drive.example.com/cv.pdf');
    expect(text).toContain('I would love to join.');
    expect(text).toContain('/hr (Applicants)');
  });

  it('sends quotes to BOOKING_NOTIFY_TO and applications to HR_NOTIFY_TO, which falls back to the desk', async () => {
    const { svc, mail } = build({ SMTP_URL: 'json', BOOKING_NOTIFY_TO: 'desk@example.com', HR_NOTIFY_TO: 'jobs@example.com' });
    const send = jest.spyOn(mail, 'send').mockResolvedValue(true);
    await svc.notifyNewQuote(quote);
    await svc.notifyNewApplication(application, vacancy);
    expect(send.mock.calls[0][0].to).toBe('desk@example.com');
    expect(send.mock.calls[1][0].to).toBe('jobs@example.com');

    const fallback = build({ SMTP_URL: 'json', BOOKING_NOTIFY_TO: 'desk@example.com' });
    const send2 = jest.spyOn(fallback.mail, 'send').mockResolvedValue(true);
    await fallback.svc.notifyNewApplication(application, vacancy);
    expect(send2.mock.calls[0][0].to).toBe('desk@example.com');
  });
});
