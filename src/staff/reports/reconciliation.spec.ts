import { reconciliationTotals } from './reconciliation';

describe('reconciliationTotals', () => {
  const rows = [
    { status: 'arrived', payMode: 'gate', adults: 2, kids: 1, total: 3000 },
    { status: 'confirmed', payMode: 'gate', adults: 1, kids: 0, total: 1000 },
    { status: 'confirmed', payMode: 'online', adults: 2, kids: 0, total: 2500 },
    { status: 'cancelled', payMode: 'gate', adults: 4, kids: 0, total: 4000 },
  ];

  it('splits the day into collected, outstanding, online and cancelled money', () => {
    expect(reconciliationTotals(rows, false)).toEqual({
      bookings: 4, guestsExpected: 6, guestsArrived: 3, gateExpected: 4000, gateCollected: 3000, gateOutstanding: 1000,
      onlinePaid: 2500, cancelled: 1, cancelledAmount: 4000, noShows: 0, noShowAmount: 0,
    });
  });

  it('counts the still-confirmed bookings of a past day as no-shows', () => {
    expect(reconciliationTotals(rows, true)).toMatchObject({ noShows: 2, noShowAmount: 3500 });
  });
});
