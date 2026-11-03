import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MpgsProvider } from './mpgs.provider';
import { providerFromConfig } from './provider-from-config';
import { SandboxProvider } from './sandbox.provider';

const config = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] }) as unknown as ConfigService;
const logger = () => ({ error: jest.fn() }) as unknown as Logger & { error: jest.Mock };

describe('providerFromConfig', () => {
  it('is off when unset or none', () => {
    expect(providerFromConfig(config({}), 'https://site', logger())).toBeNull();
    expect(providerFromConfig(config({ PAYMENT_PROVIDER: ' None ' }), 'https://site', logger())).toBeNull();
  });

  it('serves the sandbox outside production only', () => {
    expect(providerFromConfig(config({ PAYMENT_PROVIDER: 'sandbox' }), 'https://site', logger())).toBeInstanceOf(SandboxProvider);
    expect(() => providerFromConfig(config({ PAYMENT_PROVIDER: 'sandbox', NODE_ENV: 'production' }), 'https://site', logger())).toThrow(/must not run in production/);
    expect(providerFromConfig(config({ PAYMENT_PROVIDER: 'sandbox', NODE_ENV: 'production', PAYMENT_SANDBOX_IN_PRODUCTION: '1' }), 'https://site', logger())).toBeInstanceOf(SandboxProvider);
  });

  it('needs the MPGS credentials, staying off (and saying so) without them', () => {
    const log = logger();
    expect(providerFromConfig(config({ PAYMENT_PROVIDER: 'mpgs', MPGS_MERCHANT_ID: 'TEST1' }), 'https://site', log)).toBeNull();
    expect(log.error).toHaveBeenCalledWith('PAYMENT_PROVIDER=mpgs but MPGS_MERCHANT_ID / MPGS_API_PASSWORD are missing: online payment stays off');
    expect(providerFromConfig(config({ PAYMENT_PROVIDER: 'mpgs', MPGS_MERCHANT_ID: 'TEST1', MPGS_API_PASSWORD: 'pw' }), 'https://site', log)).toBeInstanceOf(MpgsProvider);
  });

  it('refuses an unknown provider', () => {
    expect(() => providerFromConfig(config({ PAYMENT_PROVIDER: 'peach' }), 'https://site', logger())).toThrow('PAYMENT_PROVIDER=peach is not implemented; use none, sandbox or mpgs');
  });
});
