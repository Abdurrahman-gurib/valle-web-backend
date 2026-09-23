import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Booking,
  BookingAudit,
  BookingLine,
  ChatConversation,
  Experience,
  Quote,
  Setting, PriceListEntry } from '../../entities';
import { StaffAuthModule } from '../auth/staff-auth.module';
import { StaffBookingsController } from './staff-bookings.controller';
import { StaffBookingsService } from './staff-bookings.service';

/**
 * The back-office read/write surface. Experience and Setting are here so a
 * staff edit can re-price a booking with the very same `computeBooking` the
 * public flow uses; ChatConversation only feeds the `openChats` counter on the
 * dashboard, the chat feature itself lives in `src/chat`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingLine,
      BookingAudit,
      Quote,
      ChatConversation,
      Experience,
      PriceListEntry,
      Setting,
    ]),
    StaffAuthModule,
  ],
  controllers: [StaffBookingsController],
  providers: [StaffBookingsService],
})
export class StaffBookingsModule {}
