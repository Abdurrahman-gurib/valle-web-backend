import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentStaff } from './current-staff.decorator';
import { CodeDto, CreateStaffUserDto, UpdateStaffUserDto } from './dto/security.dto';
import { Roles, RolesGuard } from './roles.guard';
import { StaffAuthGuard } from './staff-auth.guard';
import type { StaffPrincipal } from './staff-auth.types';
import { StaffSecurityService } from './staff-security.service';
import { StaffUsersService } from './staff-users.service';

/** The signed-in operator's own two-step login settings. */
@ApiTags('staff-security')
@Controller('staff/security')
@UseGuards(StaffAuthGuard, ThrottlerGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class StaffSecurityController {
  constructor(private readonly security: StaffSecurityService) {}

  @Get('2fa')
  status(@CurrentStaff() staff: StaffPrincipal) {
    return this.security.status(staff.id);
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setup(@CurrentStaff() staff: StaffPrincipal) {
    return this.security.beginSetup(staff.id);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  enable(@CurrentStaff() staff: StaffPrincipal, @Body() dto: CodeDto) {
    return this.security.confirmSetup(staff.id, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(200)
  async disable(@CurrentStaff() staff: StaffPrincipal, @Body() dto: CodeDto) {
    await this.security.disable(staff.id, dto.code);
    return { ok: true };
  }

  @Post('2fa/recovery-codes')
  @HttpCode(200)
  recovery(@CurrentStaff() staff: StaffPrincipal, @Body() dto: CodeDto) {
    return this.security.regenerateRecoveryCodes(staff.id, dto.code);
  }
}

/** Team administration: managers only. */
@ApiTags('staff-users')
@Controller('staff/users')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('manager')
export class StaffUsersController {
  constructor(private readonly users: StaffUsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() dto: CreateStaffUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateStaffUserDto,
  ) {
    return this.users.update(staff, id, dto);
  }

  @Post(':id/password-reset')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reset(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.sendReset(id);
  }
}
