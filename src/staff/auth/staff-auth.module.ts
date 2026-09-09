import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffUser } from '../../entities';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthGuard } from './staff-auth.guard';
import { StaffAuthService } from './staff-auth.service';
import { LoginThrottlerGuard } from './login-throttler.guard';

/**
 * Owns staff sessions. Exported so the other staff modules and the chat
 * gateway can reuse the same guard / token verification.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StaffUser]), JwtModule.register({})],
  controllers: [StaffAuthController],
  providers: [StaffAuthService, StaffAuthGuard, LoginThrottlerGuard],
  exports: [StaffAuthService, StaffAuthGuard],
})
export class StaffAuthModule {}
