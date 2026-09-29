import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking, BookingAudit, BookingLine, Experience, Setting, Waiver } from '../entities';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { TicketsModule } from '../tickets/tickets.module';
import { GateController, WaiversController } from './waivers.controller';
import { WaiversService } from './waivers.service';

/** Digital waivers (guest side, through the ticket token) and the gate check-in (staff side). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Waiver, Booking, BookingLine, BookingAudit, Experience, Setting]),
    TicketsModule,
    StaffAuthModule,
  ],
  controllers: [WaiversController, GateController],
  providers: [WaiversService],
  exports: [WaiversService],
})
export class WaiversModule {}
