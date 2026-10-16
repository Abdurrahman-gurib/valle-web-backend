import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { Booking, BookingDraft } from '../entities';
import { Mail, MailService } from '../notifications/mail.service';
import { TicketService } from '../tickets/ticket.service';

export const ABANDON_AFTER_MS = 60 * 60 * 1000;
const SWEEP_MS = 10 * 60 * 1000;
const BATCH = 50;

/**
 * One "Your day at VALLÉ is waiting" e-mail for a draft saved with an e-mail
 * address that has not become a booking within an hour. reminded_at is claimed
 * before sending, so a draft is never reminded twice.
 */
@Injectable()
export class AbandonedReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbandonedReminderService.name);
  private sweep: ReturnType<typeof setInterval> | null = null;
  private readonly on: boolean;
  private running = false;

  constructor(
    @InjectRepository(BookingDraft) private readonly draftRepo: Repository<BookingDraft>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    private readonly mail: MailService,
    config: ConfigService,
    @Optional() private readonly tickets?: TicketService,
  ) {
    this.on = (config.get<string>('ABANDONED_REMINDERS') ?? '1') !== '0';
  }

  onModuleInit(): void {
    if (!this.on || process.env.NODE_ENV === 'test') return;
    this.sweep = setInterval(() => { void this.run(); }, SWEEP_MS);
    this.sweep.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
  }

  /** Drafts due a reminder: older than an hour, not expired, never reminded, with an address. */
  async dueDrafts(now = new Date()): Promise<BookingDraft[]> {
    const drafts = await this.draftRepo.find({
      where: { remindedAt: IsNull(), createdAt: LessThan(new Date(now.getTime() - ABANDON_AFTER_MS)), expiresAt: MoreThan(now) },
      order: { createdAt: 'ASC' },
      take: BATCH,
    });
    return drafts.filter((d) => !!d.email?.trim());
  }

  /** True when the guest has booked (same e-mail, any case) since saving the draft. */
  async booked(d: BookingDraft): Promise<boolean> {
    const n = await this.bookingRepo
      .createQueryBuilder('b')
      .where('lower(b.email) = lower(:email)', { email: d.email.trim() })
      .andWhere('b.created_at > :since', { since: d.createdAt })
      .getCount();
    return n > 0;
  }

  async run(now = new Date()): Promise<{ sent: number; skipped: number }> {
    if (this.running || !this.mail.enabled) return { sent: 0, skipped: 0 };
    this.running = true;
    let sent = 0;
    let skipped = 0;
    try {
      for (const d of await this.dueDrafts(now)) {
        // Claim first so a crash or a second instance never sends twice.
        const claim = await this.draftRepo.update({ id: d.id, remindedAt: IsNull() }, { remindedAt: now });
        if (!claim.affected) continue;
        if (await this.booked(d)) { skipped++; continue; }
        if (await this.mail.send(this.message(d, now))) sent++;
      }
      if (sent || skipped) this.logger.log(`Abandoned-booking reminders: ${sent} sent, ${skipped} already booked`);
    } catch (e) {
      this.logger.error(`Abandoned-booking sweep failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return { sent, skipped };
  }

  message(d: BookingDraft, now = new Date()): Mail {
    const link = `${this.tickets?.siteUrl ?? ''}/booking?draft=${d.id}`;
    const days = Math.max(1, Math.ceil((d.expiresAt.getTime() - now.getTime()) / 86_400_000));
    return {
      to: d.email.trim(),
      subject: 'Your day at VALLÉ is waiting',
      text:
        'Hi,\n\nYou started a booking at VALLÉ Advenature Park but did not finish it. Everything you picked is still saved, so it only takes a minute to confirm:\n\n' +
        `${link}\n\nThe link works for ${days} more day${days === 1 ? '' : 's'}. Nothing is reserved until you confirm on that page. Questions? Call +230 660 44 77.\n\n` +
        'This is the only reminder we will send about this booking.\n\nVALLÉ Advenature Park',
    };
  }
}
