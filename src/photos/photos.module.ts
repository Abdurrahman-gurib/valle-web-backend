import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../entities/booking.entity';
import { BookingLine } from '../entities/booking-line.entity';
import { BookingPhoto } from '../entities/booking-photo.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { TicketsModule } from '../tickets/tickets.module';
import { GuestPhotosController, StaffPhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [TypeOrmModule.forFeature([BookingPhoto, Booking, BookingLine]), TicketsModule, StaffAuthModule, NotificationsModule],
  controllers: [GuestPhotosController, StaffPhotosController],
  providers: [PhotosService],
})
export class PhotosModule {}
