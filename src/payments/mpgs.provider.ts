import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Logger } from '@nestjs/common';
import type { CheckoutRequest, CheckoutSession, PaymentProvider, RefundResult, WebhookEvent } from './payment-provider';

export interface MpgsConfig {
  /** Gateway host, e.g. https://mcb.gateway.mastercard.com (no trailing slash). */
  host: string;
  /** Merchant ID; the TEST mode one starts with TEST. */
  merchantId: string;
  /** API password from Merchant Administration → Admin → Integration Settings. */
  apiPassword: string;
  /** Secret the gateway sends in X-Notification-Secret on webhooks (optional). */
  webhookSecret?: string;
  merchantName: string;
  /** Our API base (…/api), for the pay page and the return URL. */
  apiUrl: string;
  /** The public site, shown on the hosted page as the merchant's URL. */
  siteUrl: string;
}

type FetchFn = typeof fetch;

const API_VERSION = 100;

/**
 * Mastercard Payment Gateway Services (MCB's "MCB Gateway") through Hosted
 * Checkout: the card form is Mastercard's own page, so card details never touch
 * this server.
 *
 *  1. createCheckout → INITIATE_CHECKOUT (PURCHASE) opens a session; the guest is
 *     sent to our tiny pay page, which loads checkout.js and hands over to the
 *     gateway's payment page.
 *  2. The gateway sends the guest back to /payments/mpgs/return/:paymentId; we
 *     never trust the browser and RETRIEVE the order from the gateway to learn
 *     the outcome (verifyOrder).
 *  3. Webhook notifications, when configured, are checked against the
 *     notification secret and then also re-read from the gateway.
 *
 * Our payment row id is the gateway order id, and also our providerRef.
 */
export class MpgsProvider implements PaymentProvider {
  readonly name = 'mpgs';
  private readonly logger = new Logger('MpgsProvider');

  constructor(private readonly cfg: MpgsConfig, private readonly http: FetchFn = fetch) {}

  get host(): string {
    return this.cfg.host;
  }

  private base(): string {
    return `${this.cfg.host}/api/rest/version/${API_VERSION}/merchant/${encodeURIComponent(this.cfg.merchantId)}`;
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`merchant.${this.cfg.merchantId}:${this.cfg.apiPassword}`).toString('base64');
    const res = await this.http(this.base() + path, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { result?: string; error?: { cause?: string; explanation?: string } };
    if (!res.ok || json.result === 'ERROR') {
      const why = json.error ? `${json.error.cause ?? ''} ${json.error.explanation ?? ''}`.trim() : `HTTP ${res.status}`;
      throw new Error(`MCB gateway ${method} ${path.split('/').slice(0, 3).join('/')}: ${why}`);
    }
    return json;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const r = await this.call<{ session?: { id?: string }; successIndicator?: string }>('POST', '/session', {
      apiOperation: 'INITIATE_CHECKOUT',
      checkoutMode: 'WEBSITE',
      interaction: {
        operation: 'PURCHASE',
        merchant: { name: this.cfg.merchantName, url: this.cfg.siteUrl },
        returnUrl: `${this.cfg.apiUrl}/payments/mpgs/return/${encodeURIComponent(req.paymentId)}`,
        displayControl: { billingAddress: 'HIDE', shipping: 'HIDE' },
      },
      order: {
        id: req.paymentId,
        reference: req.refCode,
        amount: req.amount.toFixed(2),
        currency: req.currency,
        description: req.description.slice(0, 127),
      },
      customer: { email: req.guest.email || undefined },
    });
    const sessionId = r.session?.id;
    if (!sessionId) throw new Error('MCB gateway returned no checkout session');
    return {
      redirectUrl: `${this.cfg.apiUrl}/payments/mpgs/pay?session=${encodeURIComponent(sessionId)}`,
      providerRef: req.paymentId,
    };
  }

  /**
   * The gateway's own record of an order: paid when money was captured,
   * failed when the gateway says so, null while it is still undecided.
   */
  async verifyOrder(orderId: string): Promise<WebhookEvent | null> {
    let o: { status?: string; result?: string; amount?: number; totalCapturedAmount?: number; transaction?: { response?: { gatewayCode?: string } }[] };
    try {
      o = await this.call('GET', `/order/${encodeURIComponent(orderId)}`);
    } catch (e) {
      // an order the payer never submitted does not exist at the gateway yet
      this.logger.warn(`Order ${orderId} not readable: ${(e as Error).message}`);
      return null;
    }
    const status = String(o.status ?? '').toUpperCase();
    const captured = Number(o.totalCapturedAmount ?? 0);
    if (captured > 0 || status === 'CAPTURED') {
      return { paymentId: orderId, providerRef: orderId, status: 'paid', amount: Math.round(captured || Number(o.amount ?? 0)), raw: { status, amount: o.amount, captured } };
    }
    if (['FAILED', 'DECLINED', 'CANCELLED', 'AUTHENTICATION_UNSUCCESSFUL', 'EXPIRED'].includes(status)) {
      const code = o.transaction?.[o.transaction.length - 1]?.response?.gatewayCode;
      return { paymentId: orderId, providerRef: orderId, status: 'failed', amount: 0, reason: code ? `Card ${code.toLowerCase().replace(/_/g, ' ')}` : `Payment ${status.toLowerCase()}`, raw: { status, gatewayCode: code } };
    }
    return null;
  }

  async parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): Promise<WebhookEvent | null> {
    const secret = this.cfg.webhookSecret;
    if (!secret) throw new ForbiddenException('Webhooks are not configured');
    const given = String(headers['x-notification-secret'] ?? '');
    const a = Buffer.from(secret);
    const b = Buffer.from(given);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Bad notification secret');
    const orderId = (body as { order?: { id?: string } } | null)?.order?.id;
    if (!orderId) return null;
    // the notification only says "something happened": the gateway's record decides
    return this.verifyOrder(orderId);
  }

  async refund(providerRef: string, amount: number, _reason: string): Promise<RefundResult> {
    const txn = `rf-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    await this.call('PUT', `/order/${encodeURIComponent(providerRef)}/transaction/${txn}`, {
      apiOperation: 'REFUND',
      transaction: { amount: amount.toFixed(2), currency: 'MUR' },
    });
    return { providerRef: `${providerRef}/${txn}` };
  }
}
