import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking, BookingAudit, BookingLine, Experience, Setting, Waiver } from '../entities';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { TicketsModule } from '../tickets/tickets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WaiverCopyService } from './waiver-copy.service';
import { GateController, WaiversController } from './waivers.controller';
import { WaiversService } from './waivers.service';

/** Digital waivers (guest side, through the ticket token) and the gate check-in (staff side). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Waiver, Booking, BookingLine, BookingAudit, Experience, Setting]),
    TicketsModule,
    StaffAuthModule,
    NotificationsModule,
  ],
  controllers: [WaiversController, GateController],
  providers: [WaiversService, WaiverCopyService],
  exports: [WaiversService],
})
export class WaiversModule {}
