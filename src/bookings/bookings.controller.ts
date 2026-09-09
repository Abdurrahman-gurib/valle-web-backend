import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { BookingsService, BookingResponse } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';

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
const BOOKING_LIMIT = 10;
const BOOKING_TTL_MS = 600_000;

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

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
