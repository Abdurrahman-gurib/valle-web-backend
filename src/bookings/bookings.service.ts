import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Booking, BookingLine, Experience, Setting } from '../entities';
import { CreateBookingDto } from './dto/create-booking.dto';
import { computeBooking, PricedBooking } from './pricing';

export interface BookingResponse {
  refCode: string;
  total: number;
  discount: number;
  lines: { label: string; amount: number }[];
  status: string;
}

const REF_MAX_TRIES = 20;
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class BookingsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingLine)
    private readonly lineRepo: Repository<BookingLine>,
    @InjectRepository(Experience)
    private readonly experienceRepo: Repository<Experience>,
    @InjectRepository(Setting)
    private readonly settingRepo: Repository<Setting>,
  ) {}

  async create(dto: CreateBookingDto): Promise<BookingResponse> {
    const email = (dto.email ?? '').trim();
    const phone = (dto.phone ?? '').trim();
    if (!email && !phone) {
      throw new BadRequestException(
        'Provide at least an email address or a phone number',
      );
    }

    const visitDate = dto.visitDate.slice(0, 10);
    // "Today" is whatever day it is at the park, not on the server.
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Indian/Mauritius',
    }); // YYYY-MM-DD
    if (visitDate < today) {
      throw new BadRequestException('visitDate cannot be in the past');
    }

    const [experiences, settings] = await Promise.all([
      this.experienceRepo.find(),
      this.settingRepo.find(),
    ]);
    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));
    const priced = computeBooking(
      experiences,
      {
        entryAdult: parseInt(settingsMap.get('entry_adult') ?? '500', 10),
        entryChild: parseInt(settingsMap.get('entry_child') ?? '250', 10),
      },
      {
        adults: dto.adults,
        kids: dto.kids,
        rate: dto.rate,
        items: dto.items,
      },
    );

    for (let attempt = 0; attempt < REF_MAX_TRIES; attempt++) {
      const refCode = this.generateRefCode();
      try {
        return await this.persist(dto, priced, refCode, email, phone, visitDate);
      } catch (err) {
        if (this.isUniqueViolation(err)) continue; // ref collision, retry
        throw err;
      }
    }
    throw new ConflictException(
      'Could not allocate a unique booking reference, please try again',
    );
  }

  // ------------------------------------------------------------------ helpers

  private async persist(
    dto: CreateBookingDto,
    priced: PricedBooking,
    refCode: string,
    email: string,
    phone: string,
    visitDate: string,
  ): Promise<BookingResponse> {
    return this.dataSource.transaction(async (manager) => {
      const booking = manager.create(Booking, {
        refCode,
        visitDate,
        slot: dto.slot,
        adults: dto.adults,
        kids: dto.kids,
        rate: dto.rate,
        guestName: dto.name,
        phone,
        email,
        nationality: (dto.nationality ?? '').trim(),
        payMode: dto.payMode,
        status: 'confirmed',
        entryAmount: priced.entry,
        subtotal: priced.subtotal,
        discount: priced.discount,
        total: priced.total,
        currency: 'MUR',
      });
      const saved = await manager.save(booking);

      const lines = priced.lines.map((l, i) =>
        manager.create(BookingLine, {
          bookingId: saved.id,
          experienceId: l.experienceId,
          label: l.label,
          adults: l.adults,
          kids: l.kids,
          units: l.units,
          amount: l.amount,
          sortOrder: i,
        }),
      );
      await manager.save(lines);

      return {
        refCode: saved.refCode,
        total: saved.total,
        discount: saved.discount,
        lines: priced.lines.map((l) => ({ label: l.label, amount: l.amount })),
        status: saved.status,
      };
    });
  }

  /** 'VAL-' + 4 random digits (1000..9999) + '-26' */
  private generateRefCode(): string {
    const digits = 1000 + Math.floor(Math.random() * 9000);
    return `VAL-${digits}-26`;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError &&
      (err as QueryFailedError & { driverError?: { code?: string } })
        .driverError?.code === PG_UNIQUE_VIOLATION
    );
  }
}
