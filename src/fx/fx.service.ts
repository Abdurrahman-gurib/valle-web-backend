import { Injectable, Logger } from '@nestjs/common';

/**
 * Indicative exchange rates for showing prices in a visitor's own currency.
 *
 * Source: the Bank of Mauritius "consolidated indicative exchange rates" page
 * (https://www.bom.mu/markets/foreign-exchange/consolidated-indicative-exchange-rates),
 * the T.T. buying rate: what a bank pays in rupees for one unit of the foreign
 * currency, i.e. what a guest paying with that currency effectively gets. The
 * page is fetched at most every REFRESH_MS; when it is unreachable or changes
 * shape, the last good table stays in use, and before the first successful
 * fetch the FALLBACK snapshot (BoM, 28-09-2026) is served. AED and SAR are not
 * quoted by the BoM; both are pegged to the US dollar, so they are derived
 * from the USD rate at the official pegs.
 *
 * Every payment is still in rupees: these are display conversions only.
 */
export interface FxRate {
  /** Rupees per one unit of the currency. */
  mur: number;
  /** ISO 4217 name shown in the picker. */
  name: string;
  /** Symbol used in front of converted amounts. */
  symbol: string;
  /** Decimal places when formatting. */
  decimals: number;
  /** 'bom' scraped, 'peg' derived from USD, 'fallback' bundled snapshot. */
  source: 'bom' | 'peg' | 'fallback';
}

export interface FxTable {
  base: 'MUR';
  /** Date of the BoM table, YYYY-MM-DD. */
  asOf: string;
  /** When this process last fetched the page successfully, ISO. */
  fetchedAt: string | null;
  provider: string;
  rates: Record<string, FxRate>;
}

const BOM_URL = 'https://www.bom.mu/markets/foreign-exchange/consolidated-indicative-exchange-rates';
const REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/** Currency metadata; the order here is the order in the picker. */
export const CURRENCIES: Record<string, { name: string; symbol: string; decimals: number }> = {
  MUR: { name: 'Mauritian rupee', symbol: 'Rs', decimals: 0 },
  EUR: { name: 'Euro', symbol: '€', decimals: 2 },
  USD: { name: 'US dollar', symbol: 'US$', decimals: 2 },
  GBP: { name: 'British pound', symbol: '£', decimals: 2 },
  AED: { name: 'UAE dirham', symbol: 'AED', decimals: 2 },
  SAR: { name: 'Saudi riyal', symbol: 'SAR', decimals: 2 },
  INR: { name: 'Indian rupee', symbol: '₹', decimals: 0 },
  ZAR: { name: 'South African rand', symbol: 'R', decimals: 2 },
  CHF: { name: 'Swiss franc', symbol: 'CHF', decimals: 2 },
  AUD: { name: 'Australian dollar', symbol: 'A$', decimals: 2 },
  CAD: { name: 'Canadian dollar', symbol: 'C$', decimals: 2 },
  CNY: { name: 'Chinese yuan', symbol: '¥', decimals: 2 },
  JPY: { name: 'Japanese yen', symbol: '¥', decimals: 0 },
  SGD: { name: 'Singapore dollar', symbol: 'S$', decimals: 2 },
  NZD: { name: 'New Zealand dollar', symbol: 'NZ$', decimals: 2 },
};

/** Official USD pegs (units of the currency per 1 USD). */
const USD_PEGS: Record<string, number> = { AED: 3.6725, SAR: 3.75 };

/** BoM consolidated table, T.T. buying, 28-09-2026. Used until the first live fetch. */
export const FALLBACK: { asOf: string; ttBuying: Record<string, number> } = {
  asOf: '2026-09-28',
  ttBuying: {
    AUD: 33.4599, CAD: 33.3183, CNY: 7.0136, EUR: 53.2771, INR: 0.4957, JPY: 0.296612,
    NZD: 26.7428, SGD: 36.8455, ZAR: 2.8938, CHF: 56.3995, GBP: 61.9709, USD: 46.7878,
  },
};

/**
 * Pull "CODE N" + the first numeric column (T.T. buying) + the row date out of
 * the BoM HTML table. Returns null when nothing recognisable is found, so a
 * redesigned page never replaces good rates with an empty table.
 */
export function parseBomTable(html: string): { asOf: string; ttBuying: Record<string, number> } | null {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const ttBuying: Record<string, number> = {};
  let asOf = '';
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    );
    const code = cells.find((c) => /^[A-Z]{3} \d+$/.test(c));
    if (!code) continue;
    const [ccy, unitsStr] = code.split(' ');
    const units = Number(unitsStr);
    const idx = cells.indexOf(code);
    const tt = Number(cells[idx + 1]);
    if (!Number.isFinite(tt) || tt <= 0 || !units) continue;
    if (ccy in CURRENCIES && !(ccy in ttBuying)) ttBuying[ccy] = tt / units;
    const date = cells.find((c) => /^\d{2}-\d{2}-\d{4}$/.test(c));
    if (date && !asOf) asOf = date.split('-').reverse().join('-');
  }
  if (!ttBuying.USD || !ttBuying.EUR) return null;
  return { asOf: asOf || new Date().toISOString().slice(0, 10), ttBuying };
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private table: FxTable = buildTable(FALLBACK.asOf, FALLBACK.ttBuying, 'fallback', null);
  private nextFetch = 0;
  private inflight: Promise<void> | null = null;

  /** Fetches whatever the BoM page returns (overridable in tests). */
  fetchPage: () => Promise<string> = async () => {
    const res = await fetch(BOM_URL, {
      headers: { 'user-agent': 'Mozilla/5.0 (vallepark.com price display)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`BoM responded ${res.status}`);
    return res.text();
  };

  /** Current table; kicks off a refresh in the background when it is stale. */
  async rates(): Promise<FxTable> {
    if (Date.now() >= this.nextFetch) {
      const first = this.table.rates.USD.source === 'fallback';
      const p = this.refresh();
      // The very first request waits so visitors get live rates from the start;
      // later ones are served from cache while the refresh runs.
      if (first) await p;
    }
    return this.table;
  }

  private refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const parsed = parseBomTable(await this.fetchPage());
        if (!parsed) throw new Error('no rate table recognised in the BoM page');
        this.table = buildTable(parsed.asOf, parsed.ttBuying, 'bom', new Date().toISOString());
        this.nextFetch = Date.now() + REFRESH_MS;
        this.logger.log(`BoM rates refreshed (as of ${parsed.asOf}, ${Object.keys(parsed.ttBuying).length} currencies)`);
      } catch (e) {
        this.nextFetch = Date.now() + RETRY_MS;
        this.logger.warn(`BoM rates not refreshed, keeping ${this.table.rates.USD.source} table: ${(e as Error).message}`);
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}

function buildTable(asOf: string, ttBuying: Record<string, number>, source: 'bom' | 'fallback', fetchedAt: string | null): FxTable {
  const rates: Record<string, FxRate> = {
    MUR: { mur: 1, ...CURRENCIES.MUR, source },
  };
  for (const [ccy, meta] of Object.entries(CURRENCIES)) {
    if (ccy === 'MUR') continue;
    if (ttBuying[ccy]) rates[ccy] = { mur: round(ttBuying[ccy]), ...meta, source };
    else if (USD_PEGS[ccy] && ttBuying.USD) rates[ccy] = { mur: round(ttBuying.USD / USD_PEGS[ccy]), ...meta, source: 'peg' };
  }
  return { base: 'MUR', asOf, fetchedAt, provider: 'Bank of Mauritius, indicative T.T. buying rates', rates };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
