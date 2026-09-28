import { FALLBACK, FxService, parseBomTable } from './fx.service';

const row = (country: string, code: string, tt: string, date = '28-09-2026') =>
  `<tr><td>${country}</td><td>${code}</td><td>${tt}</td><td>1</td><td>1</td><td>1</td><td>1</td><td>${date}</td></tr>`;

const PAGE = `<html><table>
  <tr><th></th><th>Buying</th><th>Selling</th></tr>
  <tr><th>Country</th><th>Code</th><th>T.T</th><th>D.D</th><th>Notes</th><th>T.T/D.D</th><th>Notes</th><th>Date</th></tr>
  ${row('EMU', 'EUR 1', '53.2771')}
  ${row('INDIA', 'INR 1', '0.4957')}
  ${row('JAPAN', 'JPY 100', '29.6612')}
  ${row('U.S.A.', 'USD 1', '46.7878')}
  ${row('NOWHERE', 'XXX 1', '9.9')}
</table></html>`;

describe('parseBomTable', () => {
  it('reads the T.T. buying column per unit and the table date', () => {
    const t = parseBomTable(PAGE)!;
    expect(t.asOf).toBe('2026-09-28');
    expect(t.ttBuying.USD).toBeCloseTo(46.7878, 4);
    expect(t.ttBuying.EUR).toBeCloseTo(53.2771, 4);
    expect(t.ttBuying.INR).toBeCloseTo(0.4957, 4);
    // "JPY 100": the quote is for 100 yen
    expect(t.ttBuying.JPY).toBeCloseTo(0.296612, 6);
    expect(t.ttBuying.XXX).toBeUndefined();
  });

  it('returns null for a page without the table, so the old rates are kept', () => {
    expect(parseBomTable('<html><p>Maintenance</p></html>')).toBeNull();
    expect(parseBomTable(row('EMU', 'EUR 1', '53'))).toBeNull(); // USD missing
  });
});

describe('FxService.rates', () => {
  it('serves live BoM rates plus AED / SAR derived from the USD peg', async () => {
    const svc = new FxService();
    svc.fetchPage = async () => PAGE;
    const t = await svc.rates();
    expect(t.base).toBe('MUR');
    expect(t.asOf).toBe('2026-09-28');
    expect(t.rates.USD).toMatchObject({ mur: 46.7878, source: 'bom', symbol: 'US$' });
    expect(t.rates.AED.source).toBe('peg');
    expect(t.rates.AED.mur).toBeCloseTo(46.7878 / 3.6725, 4);
    expect(t.rates.SAR.mur).toBeCloseTo(46.7878 / 3.75, 4);
    expect(t.rates.MUR.mur).toBe(1);
  });

  it('keeps the bundled snapshot when the BoM page cannot be fetched', async () => {
    const svc = new FxService();
    svc.fetchPage = async () => { throw new Error('offline'); };
    const t = await svc.rates();
    expect(t.rates.USD).toMatchObject({ mur: FALLBACK.ttBuying.USD, source: 'fallback' });
    expect(t.asOf).toBe(FALLBACK.asOf);
  });

  it('keeps the last good table when a later fetch fails or the page changes shape', async () => {
    const svc = new FxService();
    svc.fetchPage = async () => PAGE;
    await svc.rates();
    svc.fetchPage = async () => '<html>redesigned</html>';
    // force a refresh
    (svc as unknown as { nextFetch: number }).nextFetch = 0;
    await svc.rates();
    await new Promise((r) => setTimeout(r, 0));
    const t = await svc.rates();
    expect(t.rates.USD.source).toBe('bom');
    expect(t.rates.USD.mur).toBeCloseTo(46.7878, 4);
  });
});
