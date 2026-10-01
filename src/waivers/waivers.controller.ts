import { Body, Controller, Get, Header, Headers, Ip, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsIn, IsOptional } from 'class-validator';
import { CurrentStaff } from '../staff/auth/current-staff.decorator';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import { TicketQueryDto } from '../tickets/ticket.dto';
import { IsCalendarDate } from '../common/validation';
import { CheckInDto, SignWaiverDto } from './waiver.dto';
import { GateDayRow, GateView, WaiverPublicView, WaiversService, parkToday } from './waivers.service';

/** Query classes come before the controllers: decorators read them when the class body is evaluated. */
class SampleQueryDto {
  @IsOptional()
  @IsIn(['en', 'fr', 'de', 'it', 'ar', 'ru', 'es', 'hi'])
  lang?: string;
}

class GateDayQueryDto {
  @IsOptional()
  @IsCalendarDate()
  date?: string;
}

function sendPdf(res: Response, pdf: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(pdf);
}

const WAIVER_LIMIT = Number(process.env.BOOKING_RATE_LIMIT) > 0 ? Number(process.env.BOOKING_RATE_LIMIT) * 3 : 30;

@ApiTags('waivers')
@Controller('tickets')
export class WaiversController {
  constructor(private readonly waivers: WaiversService) {}

  @Get('sample/waiver.pdf')
  @ApiOperation({ summary: 'A filled-in example of the Disclaimer Form PDF' })
  @Header('Cache-Control', 'public, max-age=86400')
  async sample(@Query() q: SampleQueryDto, @Res() res: Response): Promise<void> {
    sendPdf(res, await this.waivers.samplePdf(q.lang ?? 'en'), `valle-disclaimer-sample-${q.lang ?? 'en'}.pdf`);
  }

  @Get(':refCode/waivers/:id.pdf')
  @ApiOperation({ summary: "PDF copy of one signed waiver (needs the ticket token)" })
  @ApiResponse({ status: 403, description: 'Bad or missing token' })
  async pdf(@Param('refCode') refCode: string, @Param('id') id: string, @Query() q: TicketQueryDto, @Res() res: Response): Promise<void> {
    const { w, b } = await this.waivers.waiverOf(refCode.toUpperCase(), id, q.t);
    res.setHeader('Cache-Control', 'private, no-store');
    sendPdf(res, await this.waivers.pdf(w, b), `valle-disclaimer-${b.refCode}.pdf`);
  }

  @Get(':refCode/waivers')
  @ApiOperation({ summary: 'Who in the party has signed the waiver (needs the ticket token)' })
  @ApiResponse({ status: 403, description: 'Bad or missing token' })
  @Header('Cache-Control', 'private, no-store')
  view(@Param('refCode') refCode: string, @Query() q: TicketQueryDto): Promise<WaiverPublicView> {
    return this.waivers.publicView(refCode.toUpperCase(), q.t);
  }

  @Post(':refCode/waivers')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: WAIVER_LIMIT, ttl: 600_000 } })
  @ApiOperation({ summary: "Sign one participant's waiver; signing again under the same name replaces it" })
  @ApiResponse({ status: 409, description: 'Booking closed, or everyone has already signed' })
  sign(
    @Param('refCode') refCode: string,
    @Query() q: TicketQueryDto,
    @Body() dto: SignWaiverDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<WaiverPublicView> {
    return this.waivers.sign(refCode.toUpperCase(), q.t, dto, { ip: ip ?? '', userAgent: userAgent ?? '' });
  }
}

@ApiTags('staff')
@Controller('staff/gate')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('agent', 'manager')
export class GateController {
  constructor(private readonly waivers: WaiversService) {}

  @Get()
  @ApiOperation({ summary: "A day's arrivals with their waiver progress (default: today, park time)" })
  day(@Query() q: GateDayQueryDto): Promise<GateDayRow[]> {
    return this.waivers.gateDay(q.date ?? parkToday());
  }

  @Get(':refCode')
  @ApiOperation({ summary: 'Gate scan: booking, waivers and activity warnings' })
  view(@Param('refCode') refCode: string): Promise<GateView> {
    return this.waivers.gateView(refCode);
  }

  @Get(':refCode/waivers/:id.pdf')
  @ApiOperation({ summary: 'PDF copy of a signed waiver, for the gate' })
  async pdf(@Param('refCode') refCode: string, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const { w, b } = await this.waivers.waiverOf(refCode, id);
    res.setHeader('Cache-Control', 'private, no-store');
    sendPdf(res, await this.waivers.pdf(w, b), `valle-disclaimer-${b.refCode}.pdf`);
  }

  @Post(':refCode/check-in')
  @ApiOperation({ summary: 'Mark the party arrived; refuses missing or flagged waivers unless overridden' })
  @ApiResponse({ status: 409, description: 'Waivers missing or flagged, and no override' })
  checkIn(@Param('refCode') refCode: string, @Body() dto: CheckInDto, @CurrentStaff() staff: StaffPrincipal): Promise<GateView> {
    return this.waivers.checkIn(refCode, dto, staff);
  }
}
