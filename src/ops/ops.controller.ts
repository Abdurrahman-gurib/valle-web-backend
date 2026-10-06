import { Body, Controller, Get, Header, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import { BackupStatus, CalendarView, OpsService } from './ops.service';
import { CalendarDto } from './calendar.dto';

@ApiTags('staff-ops')
@Controller('staff/ops')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('manager')
@ApiResponse({ status: 401, description: 'No valid staff session' })
@ApiResponse({ status: 403, description: 'Managers only' })
export class OpsController {
  constructor(private readonly ops: OpsService) {}

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
}
