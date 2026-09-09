import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

interface LoginRequest {
  ip?: string;
  ips?: string[];
  body?: { email?: unknown };
}

/**
 * Brute-force guard for the login route.
 *
 * Keys on IP **and** the email being attempted rather than IP alone: the sales
 * office is behind one NAT, so an IP-only budget lets one person's bad password
 * (or an attacker hammering a single account) lock out every colleague. Per
 * (IP, email) an attacker still only gets a handful of guesses per account per
 * minute, which is useless for guessing, while a second operator signing in
 * from the same office is unaffected.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: LoginRequest): Promise<string> {
    const ip = req.ips?.length ? req.ips[0] : (req.ip ?? 'unknown-ip');
    const raw = req.body?.email;
    const email =
      typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : 'no-email';
    return Promise.resolve(`${ip}|${email}`);
  }
}
