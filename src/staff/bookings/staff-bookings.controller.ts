import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PostponeDto, RecordPaymentDto, RefundDto } from './dto/front-office.dto';
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
import { CreateStaffBookingDto } from './dto/create-staff-booking.dto';
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

  @Post('bookings')
  @ApiOperation({ summary: 'Take a booking for a guest (phone, desk, e-mail...); priced like a website booking' })
  @ApiResponse({ status: 400, description: 'Validation or pricing error' })
  create(
    @Body() dto: CreateStaffBookingDto,
    @CurrentStaff() staff: StaffPrincipal,
  ): Promise<BookingDetail> {
    return this.staffBookings.createForGuest(dto, staff);
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

  @Post('bookings/:refCode/payment')
  @ApiOperation({ summary: 'Cashier: record money taken for this booking (cash, card, Juice...)' })
  recordPayment(@Param('refCode') refCode: string, @Body() dto: RecordPaymentDto, @CurrentStaff() staff: StaffPrincipal): Promise<BookingDetail> {
    return this.staffBookings.recordPayment(refCode, dto, staff);
  }

  @Post('bookings/:refCode/refund')
  @ApiOperation({ summary: 'Send part or all of an online payment back through the provider' })
  refund(@Param('refCode') refCode: string, @Body() dto: RefundDto, @CurrentStaff() staff: StaffPrincipal): Promise<BookingDetail> {
    return this.staffBookings.refund(refCode, dto, staff);
  }

  @Post('bookings/:refCode/postpone')
  @ApiOperation({ summary: 'Weather day: postpone the visit, keep the payment, the guest picks a new date later' })
  postpone(@Param('refCode') refCode: string, @Body() dto: PostponeDto, @CurrentStaff() staff: StaffPrincipal): Promise<BookingDetail> {
    return this.staffBookings.postpone(refCode, dto.reason ?? '', staff);
  }

  @Get('bookings/:refCode/receipt.pdf')
  @ApiOperation({ summary: 'Receipt PDF for the cashier / the guest' })
  async receipt(@Param('refCode') refCode: string, @Res() res: Response): Promise<void> {
    const pdf = await this.staffBookings.receiptPdf(refCode);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="valle-receipt-${refCode}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }

  @Post('bookings/:refCode/resend-waiver')
  @ApiOperation({ summary: 'Send the guest the link to sign their waivers (e-mail, and WhatsApp when allowed)' })
  @ApiResponse({ status: 404, description: 'Unknown reference code' })
  resendWaiver(@Param('refCode') refCode: string): Promise<{ email: boolean; whatsapp: boolean }> {
    return this.staffBookings.resendWaiverLink(refCode);
  }

  @Post('bookings/:refCode/resend-ticket')
  @ApiOperation({ summary: "Re-send the guest's ticket by e-mail and WhatsApp" })
  @ApiResponse({ status: 404, description: 'Unknown reference code' })
  resendTicket(@Param('refCode') refCode: string): Promise<{ email: boolean; whatsapp: boolean }> {
    return this.staffBookings.resendTicket(refCode);
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
