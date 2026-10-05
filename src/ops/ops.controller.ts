import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import { BackupStatus, OpsService } from './ops.service';

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
}
