import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Restaurant, TableReservation } from '../entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { ReservationsController, StaffReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

/** Restaurant table reservations: asked for on the site, confirmed by the desk. */
@Module({
  imports: [TypeOrmModule.forFeature([TableReservation, Restaurant]), NotificationsModule, StaffAuthModule],
  controllers: [ReservationsController, StaffReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
