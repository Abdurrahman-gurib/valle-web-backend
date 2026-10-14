import { Body, Controller, Get, Header, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import { BackupStatus, CalendarView, OpsService } from './ops.service';
import { CalendarDto } from './calendar.dto';
import { RetentionPolicyDto } from './retention.dto';
import { RetentionService, RetentionStatus } from './retention.service';

@ApiTags('staff-ops')
@Controller('staff/ops')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('manager')
@ApiResponse({ status: 401, description: 'No valid staff session' })
@ApiResponse({ status: 403, description: 'Managers only' })
export class OpsController {
  constructor(private readonly ops: OpsService, private readonly retention: RetentionService) {}

  @Get('backups')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Nightly database backups and monthly restore tests: latest results, overdue checks, recent runs' })
  backups(): Promise<BackupStatus> {
    return this.ops.backups();
  }

  @Get('calendar')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Capacity calendar: guests per slot, per-activity limits, closed / maintenance / private days' })
  calendar(): Promise<CalendarView> {
    return this.ops.calendar();
  }

  @Put('calendar')
  @ApiOperation({ summary: 'Save the capacity calendar (takes effect on the next booking)' })
  saveCalendar(@Body() dto: CalendarDto): Promise<CalendarView> {
    return this.ops.saveCalendar(dto);
  }

  @Get('retention')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Data retention: periods in force, defaults, allowed bounds and the last runs' })
  retentionStatus(): Promise<RetentionStatus> {
    return this.retention.status();
  }

  @Put('retention')
  @ApiOperation({ summary: 'Change retention periods (within the allowed bounds); takes effect on the next daily run' })
  saveRetention(@Body() dto: RetentionPolicyDto): Promise<RetentionStatus> {
    return this.retention.savePolicy(dto);
  }

  @Post('retention/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Dry run: how many records the next retention run would delete or anonymise. Changes nothing.' })
  async previewRetention() {
    const result = await this.retention.preview();
    await this.retention.recordPreview(result.counts);
    return result;
  }
}
