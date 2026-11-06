/**
 * Pure: the day sheet's totals for the cashier's reconciliation. Cancelled
 * bookings only count as cancellations; a visit day that has passed turns the
 * bookings still "confirmed" into no-shows.
 */

export interface ReconciliationInput {
  status: string;
  payMode: string;
  adults: number;
  kids: number;
  /** Under 6s: free, but they come through the gate. */
  infants?: number;
  total: number;
}

export interface ReconciliationTotals {
  bookings: number;
  guestsExpected: number;
  guestsArrived: number;
  gateExpected: number;   // confirmed + arrived, paying at the gate
  gateCollected: number;  // arrived, paying at the gate
  gateOutstanding: number; // confirmed (not yet arrived), paying at the gate
  onlinePaid: number;     // online, not cancelled
  cancelled: number;
  cancelledAmount: number;
  noShows: number;        // still "confirmed" although the day has passed
  noShowAmount: number;
}

export function reconciliationTotals(rows: ReconciliationInput[], dayHasPassed: boolean): ReconciliationTotals {
  const t: ReconciliationTotals = {
    bookings: rows.length, guestsExpected: 0, guestsArrived: 0, gateExpected: 0, gateCollected: 0, gateOutstanding: 0,
    onlinePaid: 0, cancelled: 0, cancelledAmount: 0, noShows: 0, noShowAmount: 0,
  };
  for (const r of rows) {
    const guests = r.adults + r.kids + (r.infants ?? 0);
    if (r.status === 'cancelled') { t.cancelled++; t.cancelledAmount += r.total; continue; }
    t.guestsExpected += guests;
    if (r.status === 'arrived') t.guestsArrived += guests;
    if (r.payMode === 'online') t.onlinePaid += r.total;
    if (r.payMode === 'gate') {
      t.gateExpected += r.total;
      if (r.status === 'arrived') t.gateCollected += r.total;
      else t.gateOutstanding += r.total;
    }
    if (dayHasPassed && r.status === 'confirmed') { t.noShows++; t.noShowAmount += r.total; }
  }
  return t;
}

// ------------------------------------------------------------- money taken

/** The till's columns. Anything else recorded (an old or unknown method) counts as "other". */
export const LEDGER_METHODS = ['cash', 'card', 'juice', 'transfer', 'online', 'other'] as const;
export type LedgerMethod = (typeof LEDGER_METHODS)[number];

/** One audit row that moved a booking's paid amount, as the driver returns it. */
export interface PaymentAuditRow {
  at: string | Date;
  refCode: string;
  guestName: string;
  by: string;
  changes: Record<string, { from?: unknown; to?: unknown } | undefined> | null;
}

/** One payment (or refund, negative) recorded that day. */
export interface LedgerEntry {
  at: string;
  refCode: string;
  guestName: string;
  method: LedgerMethod;
  amount: number;
  receiptNo: string;
  by: string;
}

export type CollectedSplit = Record<LedgerMethod, number> & { total: number };

const asNumber = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

/**
 * Every payment of the day, from the booking trail: each cashier payment,
 * provider payment, transfer and refund writes one `paidAmount` entry (from →
 * to), so the difference is the money that moved and `paymentMethod` says how.
 * A refund through the provider carries no method: it went back online.
 */
export function paymentLedger(rows: PaymentAuditRow[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const r of rows) {
    const c = r.changes ?? {};
    const paid = c.paidAmount;
    if (!paid) continue;
    const amount = asNumber(paid.to) - asNumber(paid.from);
    if (amount === 0) continue;
    const raw = typeof c.paymentMethod?.to === 'string' ? c.paymentMethod.to : c.refund ? 'online' : 'other';
    const method = (LEDGER_METHODS as readonly string[]).includes(raw) ? (raw as LedgerMethod) : 'other';
    out.push({
      at: new Date(r.at).toISOString(), refCode: r.refCode, guestName: r.guestName, method, amount,
      receiptNo: typeof c.receiptNo?.to === 'string' ? c.receiptNo.to : '', by: r.by,
    });
  }
  return out;
}

/** The split the till balances against: one figure per method and their sum. */
export function collectedByMethod(entries: LedgerEntry[]): CollectedSplit {
  const split = Object.fromEntries(LEDGER_METHODS.map((m) => [m, 0])) as CollectedSplit;
  split.total = 0;
  for (const e of entries) { split[e.method] += e.amount; split.total += e.amount; }
  return split;
}
