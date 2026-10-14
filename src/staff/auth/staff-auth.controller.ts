import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentStaff } from './current-staff.decorator';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto, TwoFactorLoginDto } from './dto/security.dto';
import { StaffSecurityService } from './staff-security.service';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { StaffAuthGuard } from './staff-auth.guard';
import { StaffAuthService } from './staff-auth.service';
import type { StaffPrincipal } from './staff-auth.types';

@ApiTags('staff-auth')
@Controller('staff/auth')
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    private readonly security: StaffSecurityService,
  ) {}

  @Post('login')
  // Rate limiting is scoped to this one route so public site traffic (catalog,
  // bookings, chat) is never throttled by the login budget. The budget is per
  // (IP, email); see LoginThrottlerGuard for why IP alone is not enough.
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in, setting the httpOnly staff session cookie' })
  @ApiResponse({ status: 200, description: 'Signed in' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({
    status: 429,
    description: 'Too many attempts for this account from this address (10 / 60 s)',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaffPrincipal | { twoFactorRequired: true; pendingToken: string }> {
    const result = await this.auth.login(dto.email, dto.password);
    // Two-step accounts get no cookie yet, only a 5-minute pending token.
    if ('twoFactorRequired' in result) return result;
    res.cookie(this.auth.cookieName, result.token, this.auth.cookieOptions());
    return result.staff;
  }

  @Post('login/2fa')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Second step: 6-digit code or recovery code, then the session cookie' })
  async loginTwoFactor(
    @Body() dto: TwoFactorLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaffPrincipal> {
    const { token, staff } = await this.auth.completeTwoFactor(dto.pendingToken, dto.code);
    res.cookie(this.auth.cookieName, token, this.auth.cookieOptions());
    return staff;
  }

  @Post('forgot')
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'E-mail a reset link if the account exists; always 200' })
  async forgot(@Body() dto: ForgotPasswordDto): Promise<{ ok: true }> {
    await this.security.requestReset(dto.email);
    return { ok: true };
  }

  @Post('reset')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password with a reset token; signs out every session' })
  async reset(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.security.resetPassword(dto.token, dto.password);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the staff session cookie' })
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(this.auth.cookieName, this.auth.clearCookieOptions());
    return { ok: true };
  }

  @Get('me')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({ summary: 'The signed-in operator, or 401' })
  @ApiResponse({ status: 401, description: 'No valid session' })
  me(@CurrentStaff() staff: StaffPrincipal): StaffPrincipal {
    return staff;
  }
}
