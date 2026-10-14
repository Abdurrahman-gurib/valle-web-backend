import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffPasswordReset, StaffUser } from '../../entities';
import { MailService } from '../../notifications/mail.service';
import { StaffSecurityController, StaffUsersController } from './staff-security.controller';
import { StaffSecurityService } from './staff-security.service';
import { StaffUsersService } from './staff-users.service';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthGuard } from './staff-auth.guard';
import { StaffAuthService } from './staff-auth.service';
import { LoginThrottlerGuard } from './login-throttler.guard';

/**
 * Owns staff sessions. Exported so the other staff modules and the chat
 * gateway can reuse the same guard / token verification.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StaffUser, StaffPasswordReset]), JwtModule.register({})],
  controllers: [StaffAuthController, StaffSecurityController, StaffUsersController],
  // MailService is stateless (config only), so a local instance avoids importing
  // NotificationsModule and its dependency graph into auth.
  providers: [StaffAuthService, StaffAuthGuard, LoginThrottlerGuard, StaffSecurityService, StaffUsersService, MailService],
  exports: [StaffAuthService, StaffAuthGuard],
})
export class StaffAuthModule {}
