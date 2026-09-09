import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../auth/current-staff.decorator';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { StaffAuthGuard } from '../auth/staff-auth.guard';
import type { StaffPrincipal } from '../auth/staff-auth.types';
import {
  ListBookingsQueryDto,
  PageQueryDto,
} from './dto/list-bookings.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import {
  BookingDetail,
  BookingRow,
  Paged,
  QuoteRow,
  StaffBookingsService,
  StaffStats,
} from './staff-bookings.service';

@ApiTags('staff')
@Controller('staff')
// Guarded at class level: every route below is back office only, and restricted
// to the reservations roles. These rows carry guest names, emails and phone
// numbers, which the careers team has no business reason to read.
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('agent', 'manager')
@ApiResponse({ status: 401, description: 'No valid staff session' })
@ApiResponse({ status: 403, description: 'Signed in, but not a reservations role' })
export class StaffBookingsController {
  constructor(private readonly staffBookings: StaffBookingsService) {}

  @Get('bookings')
  @ApiOperation({ summary: 'List bookings, newest first, filtered and paged' })
  list(@Query() query: ListBookingsQueryDto): Promise<Paged<BookingRow>> {
    return this.staffBookings.list(query);
  }

  @Get('bookings/:refCode')
  @ApiOperation({
    summary: 'One booking with its priced lines, internal note and audit trail',
  })
  @ApiResponse({ status: 404, description: 'Unknown reference code' })
  detail(@Param('refCode') refCode: string): Promise<BookingDetail> {
    return this.staffBookings.detail(refCode);
  }

  @Patch('bookings/:refCode')
  @ApiOperation({
    summary:
      'Edit a booking. Money is recomputed server-side from the booking lines when the party or the rate changes; totals are never taken from the request.',
  })
  @ApiResponse({ status: 400, description: 'Empty or invalid change set' })
  @ApiResponse({ status: 404, description: 'Unknown reference code' })
  update(
    @Param('refCode') refCode: string,
    @Body() dto: UpdateBookingDto,
    @CurrentStaff() staff: StaffPrincipal,
  ): Promise<BookingDetail> {
    return this.staffBookings.update(refCode, dto, staff);
  }

  @Get('quotes')
  @ApiOperation({ summary: 'Team-building quote requests, newest first' })
  quotes(@Query() query: PageQueryDto): Promise<Paged<QuoteRow>> {
    return this.staffBookings.listQuotes(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard counters for today and this month' })
  stats(): Promise<StaffStats> {
    return this.staffBookings.stats();
  }
}
