/**
 * The contract a payment gateway adapter fulfils. The park has no merchant
 * account yet; `SandboxProvider` implements this end to end so the flow
 * (checkout page, webhook, ticket, refund) can be exercised today, and a real
 * adapter (Peach Payments, MIPS) is a second implementation of the same
 * interface, selected with PAYMENT_PROVIDER.
 */

export interface CheckoutRequest {
  /** Our payment row id: the provider must echo it back in its webhook / return. */
  paymentId: string;
  refCode: string;
  /** Rupees (MUR has no minor unit in practice; adapters convert if their API wants cents). */
  amount: number;
  currency: 'MUR';
  description: string;
  /** Where the guest lands after the hosted page, whatever the outcome. */
  returnUrl: string;
  /** Where the provider posts the outcome (server to server). */
  webhookUrl: string;
  guest: { name: string; email: string; phone: string };
}

export interface CheckoutSession {
  /** The hosted payment page to send the guest to. */
  redirectUrl: string;
  /** The provider's id for this checkout, stored on the payment row. */
  providerRef: string;
}

export interface WebhookEvent {
  /** Which payment this is about: our id when the provider echoes it, else the providerRef. */
  paymentId?: string;
  providerRef: string;
  status: 'paid' | 'failed' | 'cancelled';
  /** Rupees actually taken (for 'paid'). */
  amount: number;
  reason?: string;
  raw: unknown;
}

export interface RefundResult {
  providerRef: string;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Turn a webhook call into an event. Must verify the provider's signature and
   * throw on a bad one; return null for calls that are not payment outcomes.
   */
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown, rawBody?: Buffer): Promise<WebhookEvent | null>;
  refund(providerRef: string, amount: number, reason: string): Promise<RefundResult>;
}
