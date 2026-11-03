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
    const guests = r.adults + r.kids;
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
