import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking, BookingDraft, FunnelEvent } from '../entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AbandonedReminderService } from './abandoned-reminder.service';
import { FunnelController, FunnelStaffController } from './funnel.controller';
import { FunnelService } from './funnel.service';

/** Anonymous booking-funnel counts (public POST, manager report) and the one-off abandoned-booking reminder. */
@Module({
  imports: [TypeOrmModule.forFeature([FunnelEvent, BookingDraft, Booking]), StaffAuthModule, NotificationsModule, TicketsModule],
  controllers: [FunnelController, FunnelStaffController],
  providers: [FunnelService, AbandonedReminderService],
})
export class FunnelModule {}
