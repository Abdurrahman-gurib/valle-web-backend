import { Module } from '@nestjs/common';
import { BookingNotifierService } from './booking-notifier.service';

@Module({
  providers: [BookingNotifierService],
  exports: [BookingNotifierService],
})
export class NotificationsModule {}
