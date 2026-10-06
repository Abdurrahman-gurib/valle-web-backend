import { createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { CheckoutRequest, CheckoutSession, PaymentProvider, RefundResult, WebhookEvent } from './payment-provider';

/**
 * A stand-in gateway for development and tests: the "hosted page" is served by
 * this API (PaymentsController.sandboxPage) with a Pay and a Fail button, and
 * its outcome is delivered the way a real provider would, as a signed webhook.
 * Never selected unless PAYMENT_PROVIDER=sandbox; refuses to run in production.
 */
export class SandboxProvider implements PaymentProvider {
  readonly name = 'sandbox';

  constructor(private readonly apiUrl: string, private readonly secret: string) {}

  /** The signature a webhook body carries: HMAC over the fields that matter. */
  sign(paymentId: string, status: string, amount: number): string {
    return createHmac('sha256', this.secret).update(`sandbox:${paymentId}:${status}:${amount}`).digest('base64url');
  }

  /** Signs the link to the hosted page so nobody can open another guest's checkout. */
  pageKey(paymentId: string): string {
    return createHmac('sha256', this.secret).update(`sandbox-page:${paymentId}`).digest('base64url').slice(0, 24);
  }

  verifyPageKey(paymentId: string, key: string | undefined): boolean {
    if (!key) return false;
    const a = Buffer.from(this.pageKey(paymentId));
    const b = Buffer.from(key);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    return {
      redirectUrl: `${this.apiUrl}/payments/sandbox/${encodeURIComponent(req.paymentId)}?k=${this.pageKey(req.paymentId)}`,
      providerRef: `sbx_${req.paymentId.slice(0, 8)}`,
    };
  }

  async parseWebhook(_headers: Record<string, string | string[] | undefined>, body: unknown): Promise<WebhookEvent | null> {
    const b = (body ?? {}) as { paymentId?: string; providerRef?: string; status?: string; amount?: number; sig?: string; reason?: string };
    if (!b.paymentId || !b.status) return null;
    const expected = Buffer.from(this.sign(b.paymentId, b.status, Number(b.amount) || 0));
    const given = Buffer.from(String(b.sig ?? ''));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ForbiddenException('Bad webhook signature');
    if (b.status !== 'paid' && b.status !== 'failed' && b.status !== 'cancelled') return null;
    return { paymentId: b.paymentId, providerRef: b.providerRef ?? '', status: b.status, amount: Number(b.amount) || 0, reason: b.reason, raw: body };
  }

  async refund(providerRef: string, _amount: number, _reason: string): Promise<RefundResult> {
    return { providerRef: `${providerRef}_rf${Date.now().toString(36)}` };
  }
}
