import { OpsService } from './ops.service';
import type { Setting } from '../entities';

describe('group deposit payment details', () => {
  const make = () => {
    const store = new Map<string, string>();
    const repo = {
      findOne: jest.fn(async ({ where: { key } }: { where: { key: string } }) => (store.has(key) ? { key, value: store.get(key) } : null)),
      save: jest.fn(async (s: Setting) => { store.set(s.key, s.value); return s; }),
    };
    const ops = new OpsService({} as never, repo as never, {} as never);
    return { ops, store };
  };

  it('is empty until a manager fills it in', async () => {
    expect(await make().ops.groupPayment()).toEqual({ bankDetails: '' });
  });

  it('stores the tidied text the guest pages read', async () => {
    const { ops, store } = make();
    const saved = await ops.saveGroupPayment('  Bank: MCB  \r\nAccount: 000\r\n\r\n\r\n\r\nReference: your booking ref  ');
    expect(saved.bankDetails).toBe('Bank: MCB\nAccount: 000\n\nReference: your booking ref');
    expect(store.get('group_bank_details')).toBe(saved.bankDetails);
    expect(await ops.groupPayment()).toEqual(saved);
  });

  it('can be cleared back to "our team sends the details"', async () => {
    const { ops } = make();
    await ops.saveGroupPayment('x');
    expect((await ops.saveGroupPayment('   ')).bankDetails).toBe('');
  });
});
