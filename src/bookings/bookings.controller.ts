import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AvailabilityDay, BookingsService, BookingResponse } from './bookings.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { HoldDto } from './dto/hold.dto';

/**
 * Bookings: 10 per 10 minutes per IP, deliberately looser than the quote and
 * application budgets. One cart is one booking, but a family in a single
 * sitting legitimately books for several days or several groups (and retries
 * after a validation 400, which still counts against the budget), so five
 * would be reachable by an honest guest. Ten is not, while it still keeps a
 * flood from burning through the VAL-####-26 reference space, of which there
 * are only 9000 per year. Households behind one NAT share this budget, which
 * is the trade-off we accept for having no account to key on.
 */
// BOOKING_RATE_LIMIT overrides the ceiling; only the local docker compose stack
// does, so the e2e suite (three viewports booking in parallel from one IP) is
// not throttled. Production keeps the default.
const BOOKING_LIMIT = Number(process.env.BOOKING_RATE_LIMIT) > 0 ? Number(process.env.BOOKING_RATE_LIMIT) : 10;
const BOOKING_TTL_MS = 600_000;

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get('availability')
  @ApiOperation({ summary: 'How busy each arrival slot is (quiet / busy / very-busy / full) for the date picker' })
  @Header('Cache-Control', 'public, max-age=120')
  availability(@Query() q: AvailabilityQueryDto): Promise<AvailabilityDay[]> {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Mauritius' });
    return this.bookingsService.availability(q.from ?? today, q.days ?? 14);
  }

  @Post('hold')
  @ApiOperation({ summary: 'Hold the party\'s places for a few minutes while the guest fills in their details' })
  @ApiResponse({ status: 409, description: 'Closed, or no room in that slot / for that activity' })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: BOOKING_TTL_MS } })
  hold(@Body() dto: HoldDto): Promise<{ holdId: string; expiresAt: string }> {
    return this.bookingsService.hold(dto);
  }

  @Delete('hold/:id')
  @ApiOperation({ summary: 'Release a hold (the guest left the form)' })
  @HttpCode(204)
  async releaseHold(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.bookingsService.releaseHold(id);
  }

  @Post()
  // Public write: capped per IP so nobody can fill the reservations table
  // with fake bookings. Route-scoped, so reading the catalog stays unmetered.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: BOOKING_LIMIT, ttl: BOOKING_TTL_MS } })
  @ApiOperation({
    summary:
      'Create a booking; prices are recomputed server-side from the database',
  })
  @ApiResponse({ status: 201, description: 'Booking confirmed' })
  @ApiResponse({ status: 400, description: 'Validation or pricing error' })
  @ApiResponse({ status: 429, description: 'Too many bookings (10 / 10 min)' })
  create(@Body() dto: CreateBookingDto): Promise<BookingResponse> {
    return this.bookingsService.create(dto);
  }
}
