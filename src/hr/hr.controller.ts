import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../staff/auth/current-staff.decorator';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import {
  CreateVacancyDto,
  ListApplicationsQueryDto,
  ListVacanciesQueryDto,
  UpdateApplicationDto,
  UpdateVacancyDto,
} from './dto/hr.dto';
import {
  HrApplicationRow,
  HrPaged,
  HrService,
  HrStats,
  HrVacancyRow,
} from './hr.service';

/**
 * Careers back office. Guarded twice at class level: `StaffAuthGuard` proves
 * who is calling, `RolesGuard` checks the role `@Roles()` demands. Reservations
 * agents are deliberately excluded: applications are personal data they have no
 * business reading.
 */
@ApiTags('hr')
@Controller('hr')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('hr', 'manager')
@ApiResponse({ status: 401, description: 'No valid staff session' })
@ApiResponse({ status: 403, description: 'Signed in, but not hr or manager' })
export class HrController {
  constructor(private readonly hr: HrService) {}

  // ---------------------------------------------------------------- vacancies

  @Get('vacancies')
  @ApiOperation({
    summary: 'Every vacancy including drafts, with its application count',
  })
  vacancies(
    @Query() query: ListVacanciesQueryDto,
  ): Promise<{ items: HrVacancyRow[] }> {
    return this.hr.listVacancies(query);
  }

  @Post('vacancies')
  @ApiOperation({ summary: 'Post a role. The slug is derived server-side.' })
  createVacancy(
    @Body() dto: CreateVacancyDto,
    @CurrentStaff() staff: StaffPrincipal,
  ): Promise<HrVacancyRow> {
    return this.hr.createVacancy(dto, staff);
  }

  @Patch('vacancies/:id')
  @ApiOperation({ summary: 'Edit a role (the public slug never moves)' })
  @ApiResponse({ status: 404, description: 'No such vacancy' })
  updateVacancy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVacancyDto,
  ): Promise<HrVacancyRow> {
    return this.hr.updateVacancy(id, dto);
  }

  @Delete('vacancies/:id')
  @ApiOperation({ summary: 'Delete a role that has no applications' })
  @ApiResponse({ status: 404, description: 'No such vacancy' })
  @ApiResponse({ status: 409, description: 'It has applications: close it instead' })
  deleteVacancy(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    return this.hr.deleteVacancy(id);
  }

  // ------------------------------------------------------------- applications

  @Get('applications')
  @ApiOperation({ summary: 'Applications, newest first, filtered and paged' })
  applications(
    @Query() query: ListApplicationsQueryDto,
  ): Promise<HrPaged<HrApplicationRow>> {
    return this.hr.listApplications(query);
  }

  @Patch('applications/:id')
  @ApiOperation({ summary: 'Move an application along and note why' })
  @ApiResponse({ status: 404, description: 'No such application' })
  updateApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentStaff() staff: StaffPrincipal,
  ): Promise<HrApplicationRow> {
    return this.hr.updateApplication(id, dto, staff);
  }

  // -------------------------------------------------------------------- stats

  @Get('stats')
  @ApiOperation({ summary: 'Counters for the careers back office' })
  stats(): Promise<HrStats> {
    return this.hr.stats();
  }
}
