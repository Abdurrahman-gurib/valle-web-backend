import { NotFoundException } from '@nestjs/common';

/**
 * The value, or a 404 with the given message. For "find one or 404" lookups:
 * `orNotFound(await repo.findOne(...), 'No such payment')`. Without a message
 * the response is Nest's plain "Not Found".
 */
export function orNotFound<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) throw new NotFoundException(message);
  return value;
}

/** The 404 every booking lookup by reference answers with. */
export const noBooking = (refCode: string): NotFoundException => new NotFoundException(`No booking ${refCode}`);
