import { MpgsProvider } from './mpgs.provider';

const CFG = {
  host: 'https://mcb.gateway.mastercard.com',
  merchantId: 'TEST1010023400',
  apiPassword: 'pw',
  webhookSecret: 'whsecret',
  merchantName: 'VALLÉ Advenature Park',
  apiUrl: 'https://site.test/api',
  siteUrl: 'https://site.test',
};

function fakeFetch(reply: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = reply(url, init);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('MpgsProvider (MCB Gateway)', () => {
  it('opens a PURCHASE session with our payment id as the order id and sends the guest to the pay page', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { result: 'SUCCESS', session: { id: 'SESSION0002345678901234' }, successIndicator: 'x' } }));
    const p = new MpgsProvider(CFG, fn);
    const s = await p.createCheckout({ paymentId: 'pay-1', refCode: 'VAL-1234-56', amount: 2500, currency: 'MUR', description: 'd', returnUrl: 'r', webhookUrl: 'w', guest: { name: 'A', email: 'a@b.c', phone: '' } });
    expect(calls[0].url).toBe('https://mcb.gateway.mastercard.com/api/rest/version/100/merchant/TEST1010023400/session');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Basic ' + Buffer.from('merchant.TEST1010023400:pw').toString('base64'));
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ apiOperation: 'INITIATE_CHECKOUT', interaction: { operation: 'PURCHASE', returnUrl: 'https://site.test/api/payments/mpgs/return/pay-1' }, order: { id: 'pay-1', amount: '2500.00', currency: 'MUR' } });
    expect(s).toEqual({ redirectUrl: 'https://site.test/api/payments/mpgs/pay?session=SESSION0002345678901234', providerRef: 'pay-1' });
  });

  it('reports gateway errors with their explanation', async () => {
    const { fn } = fakeFetch(() => ({ status: 401, body: { result: 'ERROR', error: { cause: 'INVALID_REQUEST', explanation: 'Invalid credentials.' } } }));
    await expect(new MpgsProvider(CFG, fn).createCheckout({ paymentId: 'p', refCode: 'r', amount: 1, currency: 'MUR', description: '', returnUrl: '', webhookUrl: '', guest: { name: '', email: '', phone: '' } })).rejects.toThrow(/Invalid credentials/);
  });

  it('decides the outcome from the gateway order: captured is paid, declined is failed, otherwise undecided', async () => {
    let order: unknown = { status: 'CAPTURED', amount: 2500, totalCapturedAmount: 2500 };
    const { fn } = fakeFetch(() => ({ body: order }));
    const p = new MpgsProvider(CFG, fn);
    expect(await p.verifyOrder('pay-1')).toMatchObject({ paymentId: 'pay-1', status: 'paid', amount: 2500 });
    order = { status: 'FAILED', transaction: [{ response: { gatewayCode: 'DECLINED' } }] };
    expect(await p.verifyOrder('pay-1')).toMatchObject({ status: 'failed', reason: 'Card declined' });
    order = { status: 'AUTHENTICATION_INITIATED' };
    expect(await p.verifyOrder('pay-1')).toBeNull();
  });

  it('treats an order the gateway does not know as undecided', async () => {
    const { fn } = fakeFetch(() => ({ status: 400, body: { result: 'ERROR', error: { cause: 'INVALID_REQUEST' } } }));
    expect(await new MpgsProvider(CFG, fn).verifyOrder('nope')).toBeNull();
  });

  it('accepts a webhook only with the notification secret, then re-reads the order', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { status: 'CAPTURED', totalCapturedAmount: 900 } }));
    const p = new MpgsProvider(CFG, fn);
    await expect(p.parseWebhook({ 'x-notification-secret': 'wrong!!!' }, { order: { id: 'pay-2' } })).rejects.toThrow(/secret/);
    expect(calls).toHaveLength(0);
    expect(await p.parseWebhook({ 'x-notification-secret': 'whsecret' }, { order: { id: 'pay-2', status: 'CAPTURED', amount: 99999 } })).toMatchObject({ status: 'paid', amount: 900 });
    await expect(new MpgsProvider({ ...CFG, webhookSecret: undefined }, fn).parseWebhook({}, {})).rejects.toThrow(/not configured/);
  });

  it('refunds with a new transaction on the same order', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { result: 'SUCCESS' } }));
    const r = await new MpgsProvider(CFG, fn).refund('pay-1', 500, 'weather');
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].url).toMatch(/\/order\/pay-1\/transaction\/rf-/);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ apiOperation: 'REFUND', transaction: { amount: '500.00', currency: 'MUR' } });
    expect(r.providerRef).toMatch(/^pay-1\/rf-/);
  });
});
