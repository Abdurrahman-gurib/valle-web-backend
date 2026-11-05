import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Restaurant, TableReservation } from '../entities';
import { InboxNotifierService } from '../notifications/inbox-notifier.service';
import { MailService } from '../notifications/mail.service';
import type { CreateReservationDto } from './reservation.dto';
import { parkToday } from '../common/park-time';
import { PARK_PHONE } from '../notifications/guest-messages';
import { dateIn, guestLang, t, type GuestLang } from '../notifications/i18n';

/** The table's day as the guest reads it: as written (YYYY-MM-DD) in English, as before; the long local date otherwise. */
const tableDate = (day: string, lang: GuestLang): string => (lang === 'en' ? day : dateIn(String(day).slice(0, 10), lang));

export interface ReservationRow {
  id: string; restaurantId: string; restaurantName: string; guestName: string; email: string; phone: string;
  visitDate: string; visitTime: string; party: number; preorder: { item: string; qty: number }[]; notes: string;
  status: 'requested' | 'confirmed' | 'cancelled'; bookingRef: string; createdAt: string;
}

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @InjectRepository(TableReservation) private readonly repo: Repository<TableReservation>,
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
    private readonly inbox: InboxNotifierService,
    private readonly mail: MailService,
  ) {}

  async create(restaurantId: string, dto: CreateReservationDto): Promise<{ id: string; status: 'requested' }> {
    const restaurant = await this.restaurants.findOne({ where: { id: restaurantId } });
    if (!restaurant) throw new NotFoundException('No such restaurant');
    if (!(dto.email ?? '').trim() && !(dto.phone ?? '').trim()) throw new BadRequestException('Provide an e-mail address or a phone number');
    if (dto.visitDate < parkToday()) throw new BadRequestException('The date cannot be in the past');
    const saved = await this.repo.save(this.repo.create({
      restaurantId, guestName: dto.name.trim(), email: (dto.email ?? '').trim(), phone: (dto.phone ?? '').trim(),
      visitDate: dto.visitDate, visitTime: dto.visitTime, party: dto.party,
      preorder: (dto.preorder ?? []).filter((l) => l.qty > 0).map((l) => ({ item: l.item.trim().slice(0, 120), qty: Math.min(60, l.qty) })),
      notes: (dto.notes ?? '').trim(), status: 'requested', bookingRef: (dto.bookingRef ?? '').trim().toUpperCase(),
      lang: guestLang(dto.lang),
    }));
    // the desk hears about it; the guest gets an acknowledgement. Neither may fail the request.
    void this.inbox.notifyReservation(this.toRow(saved, restaurant.name)).catch(() => false);
    void this.acknowledge(saved, restaurant.name).catch((e: Error) => this.logger.warn(`Reservation ${saved.id}: acknowledgement not sent: ${e.message}`));
    return { id: saved.id, status: 'requested' };
  }

  /** The words of a table e-mail: guest, party, restaurant, the day as the guest reads it, time, park phone. */
  private vars(r: TableReservation, restaurantName: string, lang: GuestLang): Record<string, string | number> {
    return { name: r.guestName, party: r.party, restaurant: restaurantName, date: tableDate(r.visitDate, lang), time: r.visitTime, phone: PARK_PHONE };
  }

  /** The guest's acknowledgement, in the language of the page they asked from. */
  private async acknowledge(r: TableReservation, restaurantName: string): Promise<void> {
    if (!r.email || !this.mail.enabled) return;
    const lang = guestLang(r.lang);
    const v = this.vars(r, restaurantName, lang);
    const pre = r.preorder.length ? `\n${t(lang, 'table_preorder')}\n${r.preorder.map((l) => `  • ${l.qty} × ${l.item}`).join('\n')}\n` : '';
    await this.mail.send({
      to: r.email,
      subject: t(lang, 'table_subject', v),
      text: [
        t(lang, 'hiComma', v), ``,
        t(lang, 'table_request', v),
        pre,
        t(lang, 'table_changes', v), ``,
        `VALLÉ Advenature Park`,
      ].join('\n'),
    });
  }

  async list(status?: string): Promise<ReservationRow[]> {
    const rows = await this.repo.find({ order: { visitDate: 'ASC', visitTime: 'ASC' }, take: 300, ...(status ? { where: { status: status as TableReservation['status'] } } : {}) });
    const names = new Map((await this.restaurants.find()).map((x) => [x.id, x.name]));
    return rows.map((r) => this.toRow(r, names.get(r.restaurantId) ?? r.restaurantId));
  }

  async setStatus(id: string, status: 'confirmed' | 'cancelled'): Promise<ReservationRow> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('No such reservation');
    r.status = status;
    await this.repo.save(r);
    const restaurant = await this.restaurants.findOne({ where: { id: r.restaurantId } });
    const row = this.toRow(r, restaurant?.name ?? r.restaurantId);
    if (r.email && this.mail.enabled) {
      const lang = guestLang(r.lang);
      const v = this.vars(r, row.restaurantName, lang);
      const confirmed = status === 'confirmed';
      void this.mail.send({
        to: r.email,
        subject: t(lang, confirmed ? 'table_confirmedSubject' : 'table_cancelledSubject', v),
        text: `${t(lang, 'hiComma', v)}\n\n${t(lang, confirmed ? 'table_confirmed' : 'table_cancelled', v)}\n\n${confirmed ? `VALLÉ Advenature Park · ${PARK_PHONE}` : 'VALLÉ Advenature Park'}`,
      }).catch(() => false);
    }
    return row;
  }

  private toRow(r: TableReservation, restaurantName: string): ReservationRow {
    return {
      id: r.id, restaurantId: r.restaurantId, restaurantName, guestName: r.guestName, email: r.email, phone: r.phone,
      visitDate: String(r.visitDate).slice(0, 10), visitTime: r.visitTime, party: r.party, preorder: r.preorder ?? [], notes: r.notes,
      status: r.status, bookingRef: r.bookingRef, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    };
  }
}
