import type { EntityManager, Repository } from 'typeorm';
import { Coupon } from '../entities';
import { COUPON_USED_MESSAGE, CouponsService } from './coupons.service';

/** A manager that hands out one coupon row under lock and records the increment. */
function manager(row: Partial<Coupon> | null) {
  const calls: { lock?: unknown; increments: unknown[] } = { increments: [] };
  const m = {
    findOne: (_ctor: unknown, opts: { lock?: unknown }) => { calls.lock = opts.lock; return Promise.resolve(row); },
    increment: (_ctor: unknown, where: unknown, field: string, by: number) => { calls.increments.push([where, field, by]); return Promise.resolve({}); },
  } as unknown as EntityManager;
  return { m, calls };
}

describe('CouponsService.consume', () => {
  const svc = new CouponsService({} as Repository<Coupon>);

  it('locks the code row, re-checks the limit under the lock and counts the use', async () => {
    const { m, calls } = manager({ code: 'HOTEL10', active: true, maxUses: 5, uses: 4 });
    await svc.consume('hotel10', m);
    expect(calls.lock).toEqual({ mode: 'pessimistic_write' });
    expect(calls.increments).toEqual([[{ code: 'HOTEL10' }, 'uses', 1]]);
  });

  it('refuses the use that would pass max_uses, so a race for the last one cannot overshoot', async () => {
    const { m, calls } = manager({ code: 'HOTEL10', active: true, maxUses: 5, uses: 5 });
    await expect(svc.consume('HOTEL10', m)).rejects.toMatchObject({ status: 409, message: COUPON_USED_MESSAGE });
    expect(calls.increments).toHaveLength(0);
  });

  it('refuses a code switched off between validation and the booking transaction', async () => {
    const { m } = manager({ code: 'HOTEL10', active: false, maxUses: null, uses: 0 });
    await expect(svc.consume('HOTEL10', m)).rejects.toMatchObject({ status: 404 });
  });

  it('unlimited codes are only counted', async () => {
    const { m, calls } = manager({ code: 'FREEDAY', active: true, maxUses: null, uses: 999 });
    await svc.consume('FREEDAY', m);
    expect(calls.increments).toHaveLength(1);
  });
});
