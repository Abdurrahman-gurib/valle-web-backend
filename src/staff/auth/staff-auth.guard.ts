import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { StaffAuthService } from './staff-auth.service';
import type { RequestWithStaff } from './staff-auth.types';

/**
 * Protects every `/api/staff/**` route except `auth/login`. Reads the httpOnly
 * session cookie, verifies it, and attaches the principal for @CurrentStaff().
 */
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(private readonly auth: StaffAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithStaff>();
    const token = request.cookies?.[this.auth.cookieName];
    if (!token) throw new UnauthorizedException('Not signed in');

    const staff = await this.auth.staffFromToken(token);
    if (!staff) throw new UnauthorizedException('Not signed in');

    request.staff = staff;
    return true;
  }
}
