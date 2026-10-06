import { Body, Controller, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { BookingItemDto } from '../../bookings/dto/create-booking.dto';
import { IsSafeText } from '../../common/validation';
import { TicketQueryDto } from '../../tickets/ticket.dto';
import type { TicketView } from '../../tickets/ticket.service';
import { StaffBookingsService } from './staff-bookings.service';

/** What a guest may change from their ticket page: when, how many, what. */
export class GuestChangeDto {
  @ApiPropertyOptional({ example: '2026-11-21' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  visitDate?: string;

  @ApiPropertyOptional({ enum: ['morning', 'afternoon'] })
  @IsOptional() @IsIn(['morning', 'afternoon'])
  slot?: 'morning' | 'afternoon';

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional() @IsInt() @Min(1) @Max(12)
  adults?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 12 })
  @IsOptional() @IsInt() @Min(0) @Max(12)
  kids?: number;

  @ApiPropertyOptional({ type: [BookingItemDto], description: 'The full new list of experiences' })
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BookingItemDto)
  items?: BookingItemDto[];
}

export class GuestCancelDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(200)
  reason?: string;
}

/**
 * Self-service from the ticket link (token-gated like the ticket itself):
 * change the date or slot, the party, the experiences, or cancel. Goes through
 * the same re-pricing, capacity check and audit trail as a desk edit, under
 * the "guest" name in the trail.
 */
@ApiTags('tickets')
@Controller('tickets')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 10 * 60_000 } })
export class GuestChangesController {
  constructor(private readonly bookings: StaffBookingsService) {}

  @Patch(':refCode/booking')
  @ApiOperation({ summary: 'Guest: change date, slot, party or experiences (needs the ticket token)' })
  @ApiResponse({ status: 409, description: 'No room on that date / slot, or the change is no longer allowed' })
  @Header('Cache-Control', 'private, no-store')
  change(@Param('refCode') refCode: string, @Query() q: TicketQueryDto, @Body() dto: GuestChangeDto): Promise<TicketView> {
    return this.bookings.guestChange(refCode.toUpperCase(), q.t, dto);
  }

  @Post(':refCode/cancel')
  @ApiOperation({ summary: 'Guest: cancel the booking (needs the ticket token)' })
  @Header('Cache-Control', 'private, no-store')
  cancel(@Param('refCode') refCode: string, @Query() q: TicketQueryDto, @Body() dto: GuestCancelDto): Promise<TicketView> {
    return this.bookings.guestCancel(refCode.toUpperCase(), q.t, dto.reason ?? '');
  }
}
