import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TicketsModule } from '../tickets/tickets.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PaymentsModule } from '../payments/payments.module';
import { Booking, BookingLine, Experience, Setting, PriceListEntry, SlotHold } from '../entities';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, BookingLine, Experience, PriceListEntry, Setting, SlotHold]),
    // Live "booking:new" to the staff room and the e-mail to the desk.
    ChatModule,
    NotificationsModule,
    TicketsModule,
    CouponsModule,
    // "Pay online now": a hosted checkout opened right after the booking is written.
    PaymentsModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
