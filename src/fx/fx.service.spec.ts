import { FALLBACK, FxService, parseBomTable } from './fx.service';

const row = (country: string, code: string, tt: string, date = '28-09-2026') =>
  `<tr><td>${country}</td><td>${code}</td><td>${tt}</td><td>1</td><td>1</td><td>1</td><td>1</td><td>${date}</td></tr>`;
/** The small undated "notes" table under the consolidated one. */
const notesRow = (code: string, buy: string) => `<tr><td>${code}</td><td>${buy}</td><td>99</td></tr>`;

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
    expect(parseBomTable(notesRow('USD 1', '46.6'))).toBeNull(); // undated rows alone are not trusted
  });

  it('ignores the undated notes table and takes the newest dated table', () => {
    const page = `<table>${row('U.S.A.', 'USD 1', '46.7878', '28-09-2026')}${row('EMU', 'EUR 1', '53.2771', '28-09-2026')}
      ${row('U.S.A.', 'USD 1', '46.9146', '29-09-2026')}${row('EMU', 'EUR 1', '53.2981', '29-09-2026')}
      ${notesRow('USD 1', '46.6124')}</table>`;
    const t = parseBomTable(page)!;
    expect(t.asOf).toBe('2026-09-29');
    expect(t.ttBuying.USD).toBeCloseTo(46.9146, 4);
  });

  it('skips a half-updated row (empty T.T. cell) instead of yielding 0', () => {
    const page = `<table>${row('U.S.A.', 'USD 1', '', '29-09-2026')}${row('EMU', 'EUR 1', '53.2981', '29-09-2026')}${notesRow('USD 1', '46.6124')}</table>`;
    const t = parseBomTable(page)!;
    expect(t.asOf).toBe('2026-09-29');
    expect(t.ttBuying.USD).toBeUndefined();
    expect(t.ttBuying.EUR).toBeCloseTo(53.2981, 4);
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

  it("keeps a currency's previous rate when today's table lacks it, and retries sooner", async () => {
    const svc = new FxService();
    svc.fetchPage = async () => PAGE; // 28-09, USD 46.7878
    await svc.rates();
    svc.fetchPage = async () => `<table>${row('U.S.A.', 'USD 1', '', '29-09-2026')}${row('EMU', 'EUR 1', '53.2981', '29-09-2026')}${notesRow('USD 1', '46.6124')}</table>`;
    (svc as unknown as { nextFetch: number }).nextFetch = 0;
    await svc.rates();
    await new Promise((r) => setTimeout(r, 0));
    const t = await svc.rates();
    expect(t.asOf).toBe('2026-09-29');
    expect(t.rates.EUR.mur).toBeCloseTo(53.2981, 4);
    expect(t.rates.USD.mur).toBeCloseTo(46.7878, 4); // yesterday's T.T., never the notes table's 46.6124
    expect((svc as unknown as { nextFetch: number }).nextFetch - Date.now()).toBeLessThan(11 * 60 * 1000);
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
