import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestWithStaff, StaffPrincipal } from './staff-auth.types';

/**
 * The operator StaffAuthGuard resolved for this request.
 * Only valid on routes behind `@UseGuards(StaffAuthGuard)`.
 */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffPrincipal => {
    const request = context.switchToHttp().getRequest<RequestWithStaff>();
    return request.staff as StaffPrincipal;
  },
);
