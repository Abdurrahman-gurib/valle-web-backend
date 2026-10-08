import { Body, Controller, Get, Header, Put, UseGuards } from '@nestjs/common';
import { LiveOpsService, LiveOpsView } from './live-ops.service';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsSafeText } from '../common/validation';
import { CurrentStaff } from '../staff/auth/current-staff.decorator';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import { ParkStatus, ParkStatusService } from './park-status.service';
import { WeatherService, WeatherView } from './weather.service';

export class ParkStatusDto {
  @ApiProperty({ enum: ['open', 'partial', 'closed'] })
  @IsIn(['open', 'partial', 'closed'])
  state: 'open' | 'partial' | 'closed';

  @ApiPropertyOptional({ maxLength: 240, description: 'What guests read' })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(240)
  message?: string;

  @ApiPropertyOptional({ type: [String], description: 'Experience ids paused right now' })
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(60, { each: true })
  pausedActivities?: string[];
}

export class LiveOpsDto {
  @ApiProperty({ description: 'Per experience id: { waitMin: minutes | null, meetingPoint?, note? }', type: Object })
  @IsObject()
  activities: Record<string, { waitMin?: number | null; meetingPoint?: string; note?: string }>;
}

@ApiTags('weather')
@Controller()
export class WeatherController {
  constructor(private readonly weather: WeatherService, private readonly status: ParkStatusService, private readonly live: LiveOpsService) {}

  @Get('park-live')
  @ApiOperation({ summary: 'Live per-activity info for the visit day: wait, meeting point, note, paused' })
  @Header('Cache-Control', 'no-store')
  parkLive(): Promise<LiveOpsView> {
    return this.live.get();
  }

  @Get('weather')
  @ApiOperation({ summary: 'Live weather at the park (Open-Meteo): now, next 12 hours, 7 days' })
  @Header('Cache-Control', 'public, max-age=300')
  current(): Promise<WeatherView> {
    return this.weather.current();
  }

  @Get('park-status')
  @ApiOperation({ summary: 'Open / partly open / closed today, and which activities are paused' })
  @Header('Cache-Control', 'no-store')
  parkStatus(): Promise<ParkStatus> {
    return this.status.get();
  }
}

@ApiTags('staff-ops')
@Controller('staff/ops/park-status')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('agent', 'manager')
export class StaffParkStatusController {
  constructor(private readonly status: ParkStatusService, private readonly live: LiveOpsService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  getLive(): Promise<LiveOpsView> {
    return this.live.get();
  }

  @Put('live')
  @ApiOperation({ summary: 'Set the wait, meeting point and note per activity (what the ticket shows on the day)' })
  setLive(@Body() dto: LiveOpsDto, @CurrentStaff() staff: StaffPrincipal): Promise<LiveOpsView> {
    return this.live.set(dto.activities ?? {}, staff.email);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  get(): Promise<ParkStatus> {
    return this.status.get();
  }

  @Put()
  @ApiOperation({ summary: "Set today's park status: the site banner, the ticket, the activity pages and the evening reminder read it" })
  set(@Body() dto: ParkStatusDto, @CurrentStaff() staff: StaffPrincipal): Promise<ParkStatus> {
    return this.status.set(dto, staff.email);
  }
}
