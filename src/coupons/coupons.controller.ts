import { Body, Controller, Get, Header, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsCalendarDate, IsSafeText } from '../common/validation';
import { CurrentStaff } from '../staff/auth/current-staff.decorator';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import { CouponOffer, CouponRow, CouponsService } from './coupons.service';

export class CreateCouponDto {
  @ApiProperty({ example: 'HOTEL10' }) @IsString() @Matches(/^[A-Za-z0-9 -]{3,24}$/)
  code: string;

  @ApiProperty({ enum: ['percent', 'amount', 'foc', 'entry_free'] }) @IsIn(['percent', 'amount', 'foc', 'entry_free'])
  kind: 'percent' | 'amount' | 'foc' | 'entry_free';

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000)
  value?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsSafeText() @MaxLength(120)
  note?: string;

  @ApiPropertyOptional() @IsOptional() @IsCalendarDate()
  validFrom?: string;

  @ApiPropertyOptional() @IsOptional() @IsCalendarDate()
  validTo?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000)
  maxUses?: number;
}

class SetActiveDto {
  @ApiProperty() @IsBoolean()
  active: boolean;
}

@ApiTags('coupons')
@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get(':code')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'What a promo code gives, if it can be used today' })
  @ApiResponse({ status: 404, description: 'Unknown, inactive, expired or used-up code' })
  @Header('Cache-Control', 'no-store')
  check(@Param('code') code: string): Promise<CouponOffer> {
    return this.coupons.resolve(code);
  }
}

@ApiTags('staff')
@Controller('staff/coupons')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('agent', 'manager')
export class StaffCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @ApiOperation({ summary: 'All coupon codes, newest first' })
  list(): Promise<CouponRow[]> {
    return this.coupons.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a coupon code' })
  create(@Body() dto: CreateCouponDto, @CurrentStaff() staff: StaffPrincipal): Promise<CouponRow> {
    return this.coupons.create(dto, staff.email);
  }

  @Patch(':code')
  @ApiOperation({ summary: 'Switch a code on or off' })
  setActive(@Param('code') code: string, @Body() dto: SetActiveDto): Promise<CouponRow> {
    return this.coupons.setActive(code, dto.active);
  }
}
