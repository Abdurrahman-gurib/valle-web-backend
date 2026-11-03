import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PaymentProvider } from './payment-provider';
import { MpgsProvider } from './mpgs.provider';
import { SandboxProvider } from './sandbox.provider';

const DEV_SECRET = 'valle-dev-only-jwt-secret-change-me';
const DEFAULT_MPGS_HOST = 'https://mcb.gateway.mastercard.com';
const DEFAULT_MERCHANT_NAME = 'VALLÉ Advenature Park';

/**
 * The gateway behind online payment, from PAYMENT_PROVIDER: `none` (or unset)
 * gives null, the site then offers pay on arrival only. Throws for a value
 * that must not boot (sandbox in production, an unknown provider).
 */
export function providerFromConfig(config: ConfigService, siteUrl: string, logger: Logger): PaymentProvider | null {
  const get = (key: string): string | undefined => config.get<string>(key)?.trim();
  const name = (config.get<string>('PAYMENT_PROVIDER') ?? 'none').trim().toLowerCase();
  const apiUrl = siteUrl + '/api';
  if (name === 'sandbox') {
    if (config.get<string>('NODE_ENV') === 'production' && config.get<string>('PAYMENT_SANDBOX_IN_PRODUCTION') !== '1') {
      throw new Error('PAYMENT_PROVIDER=sandbox takes no money and must not run in production');
    }
    return new SandboxProvider(apiUrl, get('TICKET_SECRET') || get('JWT_SECRET') || DEV_SECRET);
  }
  if (name === 'mpgs') {
    // MCB Gateway (Mastercard Payment Gateway Services). Missing credentials
    // switch online payment off rather than stopping the API.
    const merchantId = get('MPGS_MERCHANT_ID');
    const apiPassword = get('MPGS_API_PASSWORD');
    if (!merchantId || !apiPassword) {
      logger.error('PAYMENT_PROVIDER=mpgs but MPGS_MERCHANT_ID / MPGS_API_PASSWORD are missing: online payment stays off');
      return null;
    }
    return new MpgsProvider({
      host: (get('MPGS_HOST') || DEFAULT_MPGS_HOST).replace(/\/+$/, ''),
      merchantId,
      apiPassword,
      webhookSecret: get('MPGS_WEBHOOK_SECRET') || undefined,
      merchantName: get('MPGS_MERCHANT_NAME') || DEFAULT_MERCHANT_NAME,
      apiUrl,
      siteUrl,
    });
  }
  if (name === 'none' || name === '') return null;
  throw new Error(`PAYMENT_PROVIDER=${name} is not implemented; use none, sandbox or mpgs`);
}
