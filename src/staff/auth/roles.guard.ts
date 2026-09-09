import {
  CanActivate,
  CustomDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithStaff, StaffRole } from './staff-auth.types';

/** Metadata key holding the roles a handler (or controller) requires. */
export const ROLES_KEY = 'valle:required-roles';

/**
 * Restrict a route (or a whole controller) to some staff roles.
 *
 * Always pair it with `StaffAuthGuard`, which is what proves who the caller is:
 * `@UseGuards(StaffAuthGuard, RolesGuard)` then `@Roles('hr', 'manager')`.
 */
export const Roles = (...roles: StaffRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Authorisation half of the pair. It never authenticates: it reads the
 * principal `StaffAuthGuard` already attached to the request and compares its
 * role against the metadata `@Roles()` left on the handler, falling back to the
 * controller. No metadata means no role restriction, so this guard is inert
 * unless a route asks for one.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithStaff>();
    const staff = request.staff;
    // Guard order is a wiring detail the caller must not be able to notice:
    // if the principal is missing, this is "not signed in", not "forbidden".
    if (!staff) throw new UnauthorizedException('Not signed in');

    if (!required.includes(staff.role)) {
      throw new ForbiddenException(
        'Your account does not have access to this area',
      );
    }
    return true;
  }
}
