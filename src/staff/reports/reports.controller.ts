import { BadRequestException, Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { StaffAuthGuard } from '../auth/staff-auth.guard';
import { DateQueryDto, ExportQueryDto, ForecastQueryDto, RangeQueryDto } from './reports.dto';
import {
  ExperienceRow, ForecastDay, NationalityRow, Reconciliation, ReportsService, SalesSummary, parkToday,
} from './reports.service';

const MAX_RANGE_DAYS = 400;

/** This month by default; refuses ranges longer than about a year. */
function range(q: RangeQueryDto): { from: string; to: string } {
  const today = parkToday();
  const from = q.from ?? today.slice(0, 8) + '01';
  const to = q.to ?? today;
  if (to < from) throw new BadRequestException('"to" must not be before "from"');
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) throw new BadRequestException(`Range too long: at most ${MAX_RANGE_DAYS} days`);
  return { from, to };
}

@ApiTags('staff-reports')
@Controller('staff/reports')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('agent', 'manager')
@ApiResponse({ status: 401, description: 'No valid staff session' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Sales by visit date: totals, breakdowns by status / payment / rate / slot, daily series' })
  summary(@Query() q: RangeQueryDto): Promise<SalesSummary> {
    const { from, to } = range(q);
    return this.reports.summary(from, to);
  }

  @Get('nationalities')
  @ApiOperation({ summary: 'Guests and revenue by nationality' })
  nationalities(@Query() q: RangeQueryDto): Promise<NationalityRow[]> {
    const { from, to } = range(q);
    return this.reports.nationalities(from, to);
  }

  @Get('experiences')
  @ApiOperation({ summary: 'What sells: bookings and revenue per experience option' })
  experiences(@Query() q: RangeQueryDto): Promise<ExperienceRow[]> {
    const { from, to } = range(q);
    return this.reports.experiences(from, to);
  }

  @Get('reconciliation')
  @ApiOperation({ summary: "One day's cash position: expected at the gate, collected, paid online, cancelled, no-shows" })
  reconciliation(@Query() q: DateQueryDto): Promise<Reconciliation> {
    return this.reports.reconciliation(q.date ?? parkToday());
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Booked guests and revenue per upcoming day against the typical level for that weekday' })
  forecast(@Query() q: ForecastQueryDto): Promise<ForecastDay[]> {
    return this.reports.forecast(q.days ?? 30);
  }

  @Get('export.csv')
  @ApiOperation({ summary: 'CSV download: bookings, daily sales, nationalities or experiences for a visit-date range' })
  @Header('Cache-Control', 'no-store')
  async exportCsv(@Query() q: ExportQueryDto, @Res() res: Response): Promise<void> {
    const { from, to } = range(q);
    const { filename, csv } = await this.reports.exportCsv(q.type ?? 'bookings', from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
