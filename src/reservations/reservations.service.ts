import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Restaurant, TableReservation } from '../entities';
import { InboxNotifierService } from '../notifications/inbox-notifier.service';
import { MailService } from '../notifications/mail.service';
import type { CreateReservationDto } from './reservation.dto';

export interface ReservationRow {
  id: string; restaurantId: string; restaurantName: string; guestName: string; email: string; phone: string;
  visitDate: string; visitTime: string; party: number; preorder: { item: string; qty: number }[]; notes: string;
  status: 'requested' | 'confirmed' | 'cancelled'; bookingRef: string; createdAt: string;
}

const parkToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Mauritius' });

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
    }));
    // the desk hears about it; the guest gets an acknowledgement. Neither may fail the request.
    void this.inbox.notifyReservation(this.toRow(saved, restaurant.name)).catch(() => false);
    void this.acknowledge(saved, restaurant.name).catch((e: Error) => this.logger.warn(`Reservation ${saved.id}: acknowledgement not sent: ${e.message}`));
    return { id: saved.id, status: 'requested' };
  }

  private async acknowledge(r: TableReservation, restaurantName: string): Promise<void> {
    if (!r.email || !this.mail.enabled) return;
    const pre = r.preorder.length ? `\nPre-order:\n${r.preorder.map((l) => `  • ${l.qty} × ${l.item}`).join('\n')}\n` : '';
    await this.mail.send({
      to: r.email,
      subject: `Your table at ${restaurantName} · ${r.visitDate} ${r.visitTime}`,
      text: [
        `Hi ${r.guestName},`, ``,
        `We have your request for a table of ${r.party} at ${restaurantName} on ${r.visitDate} at ${r.visitTime}. The team confirms it shortly by e-mail or phone.`,
        pre,
        `Changes or questions: reply to this e-mail or call +230 660 44 77.`, ``,
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
      void this.mail.send({
        to: r.email,
        subject: `${status === 'confirmed' ? 'Confirmed' : 'Cancelled'}: your table at ${row.restaurantName} · ${r.visitDate} ${r.visitTime}`,
        text: status === 'confirmed'
          ? `Hi ${r.guestName},\n\nYour table of ${r.party} at ${row.restaurantName} on ${r.visitDate} at ${r.visitTime} is confirmed. See you then!\n\nVALLÉ Advenature Park · +230 660 44 77`
          : `Hi ${r.guestName},\n\nWe could not keep a table of ${r.party} at ${row.restaurantName} on ${r.visitDate} at ${r.visitTime}. Call +230 660 44 77 and we will find another time.\n\nVALLÉ Advenature Park`,
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
