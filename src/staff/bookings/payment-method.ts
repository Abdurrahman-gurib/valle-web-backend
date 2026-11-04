/**
 * The booking's `payment_method` column is a summary for the drawer and the
 * receipt: every method money arrived by, in order, joined with "+"
 * ("cash+card"). The per-payment amounts live in the booking's audit trail
 * (one `paidAmount` entry per payment), which is what the day's reconciliation
 * adds up.
 */
export function mergePaymentMethod(current: string | null | undefined, next: string): string {
  const seen = (current ?? '').split('+').map((m) => m.trim()).filter(Boolean);
  if (!seen.includes(next)) seen.push(next);
  return seen.join('+');
}
