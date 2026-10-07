import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import { CreateReservationDto, SetReservationStatusDto } from './reservation.dto';
import { ReservationRow, ReservationsService } from './reservations.service';

@ApiTags('restaurants')
@Controller('restaurants')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post(':id/reservations')
  @ApiOperation({ summary: 'Ask for a table: date, time, party, optional pre-order from the menu' })
  @ApiResponse({ status: 404, description: 'Unknown restaurant' })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 8, ttl: 10 * 60_000 } })
  create(@Param('id') id: string, @Body() dto: CreateReservationDto): Promise<{ id: string; status: 'requested' }> {
    return this.reservations.create(id, dto);
  }
}

@ApiTags('staff-reservations')
@Controller('staff/reservations')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('agent', 'manager')
export class StaffReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Table reservations, soonest first (status filter optional)' })
  list(@Query('status') status?: string): Promise<ReservationRow[]> {
    return this.reservations.list(status);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Confirm or cancel a table; the guest is e-mailed' })
  setStatus(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SetReservationStatusDto): Promise<ReservationRow> {
    return this.reservations.setStatus(id, dto.status);
  }
}
