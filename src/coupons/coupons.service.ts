import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Coupon } from '../entities';
import type { AdjustmentKind } from '../bookings/pricing';

export interface CouponOffer {
  code: string;
  kind: AdjustmentKind;
  value: number;
  note: string;
}

export interface CouponRow extends CouponOffer {
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  maxUses: number | null;
  uses: number;
  createdBy: string;
  createdAt: string;
}

/** 409 when the last use of a limited code went to a booking committed a moment earlier. */
export const COUPON_USED_MESSAGE = 'This code has just been fully used. Remove it or try another.';

const parkToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Mauritius' });
const d = (v: string | Date | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Coupon codes: validated for the guest on the website, applied to bookings, managed by staff. */
@Injectable()
export class CouponsService {
  constructor(@InjectRepository(Coupon) private readonly repo: Repository<Coupon>) {}

  static normalise(code: string): string {
    return code.trim().toUpperCase().replace(/\s+/g, '');
  }

  /** The offer behind a code, or a 404 with the reason it cannot be used. */
  async resolve(rawCode: string, manager?: EntityManager): Promise<CouponOffer> {
    const code = CouponsService.normalise(rawCode);
    if (!code) throw new BadRequestException('Enter a code');
    const c = await (manager ? manager.findOne(Coupon, { where: { code } }) : this.repo.findOne({ where: { code } }));
    if (!c || !c.active) throw new NotFoundException('This code is not valid');
    const today = parkToday();
    if (c.validFrom && d(c.validFrom)! > today) throw new NotFoundException('This code is not active yet');
    if (c.validTo && d(c.validTo)! < today) throw new NotFoundException('This code has expired');
    if (c.maxUses !== null && c.uses >= c.maxUses) throw new NotFoundException('This code has been fully used');
    return { code: c.code, kind: c.kind, value: c.value, note: c.note };
  }

  /**
   * Count one use, inside the booking transaction. The row is locked first and
   * the limit re-checked under the lock, so two bookings racing for the last
   * use of a code cannot both get it: the second one waits, sees uses = max
   * and is refused, and its booking rolls back with it.
   */
  async consume(code: string, manager: EntityManager): Promise<void> {
    const c = await manager.findOne(Coupon, { where: { code: CouponsService.normalise(code) }, lock: { mode: 'pessimistic_write' } });
    if (!c || !c.active) throw new NotFoundException('This code is not valid');
    if (c.maxUses !== null && c.uses >= c.maxUses) throw new ConflictException(COUPON_USED_MESSAGE);
    await manager.increment(Coupon, { code: c.code }, 'uses', 1);
  }

  // ---------------------------------------------------------------- staff

  async list(): Promise<CouponRow[]> {
    const rows = await this.repo.find({ order: { createdAt: 'DESC' } });
    return rows.map(toRow);
  }

  async create(input: { code: string; kind: AdjustmentKind; value?: number; note?: string; validFrom?: string; validTo?: string; maxUses?: number }, by: string): Promise<CouponRow> {
    const code = CouponsService.normalise(input.code);
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) throw new BadRequestException('Codes use 3 to 24 letters, digits or dashes');
    if (await this.repo.findOne({ where: { code } })) throw new ConflictException(`Code ${code} already exists`);
    if (input.kind === 'percent' && !(input.value && input.value >= 1 && input.value <= 100)) throw new BadRequestException('A percentage needs a value from 1 to 100');
    if (input.kind === 'amount' && !(input.value && input.value >= 1)) throw new BadRequestException('An amount needs a value in rupees');
    const row = this.repo.create({
      code, kind: input.kind as Coupon['kind'], value: input.kind === 'foc' || input.kind === 'entry_free' ? 0 : Math.round(input.value ?? 0),
      note: (input.note ?? '').trim(), active: true, validFrom: input.validFrom ?? null, validTo: input.validTo ?? null,
      maxUses: input.maxUses ?? null, createdBy: by,
    });
    return toRow(await this.repo.save(row));
  }

  async setActive(code: string, active: boolean): Promise<CouponRow> {
    const c = await this.repo.findOne({ where: { code: CouponsService.normalise(code) } });
    if (!c) throw new NotFoundException('No such code');
    c.active = active;
    return toRow(await this.repo.save(c));
  }
}

function toRow(c: Coupon): CouponRow {
  return {
    code: c.code, kind: c.kind, value: c.value, note: c.note, active: c.active,
    validFrom: d(c.validFrom), validTo: d(c.validTo), maxUses: c.maxUses, uses: c.uses,
    createdBy: c.createdBy, createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
  };
}
