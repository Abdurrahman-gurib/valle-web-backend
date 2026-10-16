import { Body, Controller, Get, Header, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import { FunnelEventDto } from './funnel.dto';
import { FunnelReport, FunnelService } from './funnel.service';

@ApiTags('funnel')
@Controller('funnel')
export class FunnelController {
  constructor(private readonly funnel: FunnelService) {}

  @Post()
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Record one anonymous booking-funnel step (no IP or user agent stored)' })
  async record(@Body() dto: FunnelEventDto): Promise<void> {
    await this.funnel.record(dto);
  }
}

@ApiTags('staff-ops')
@Controller('staff/ops/funnel')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('manager')
@ApiResponse({ status: 401, description: 'No valid staff session' })
@ApiResponse({ status: 403, description: 'Managers only' })
export class FunnelStaffController {
  constructor(private readonly funnel: FunnelService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Booking funnel: per-day step counts, conversion chain (distinct sessions), package/add-on/suggestion tallies' })
  report(@Query('from') from?: string, @Query('to') to?: string): Promise<FunnelReport> {
    return this.funnel.report(from, to);
  }
}
