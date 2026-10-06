import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking, BookingLine } from '../entities';
import { TicketsModule } from '../tickets/tickets.module';
import { BookingNotifierService } from './booking-notifier.service';
import { GuestMessagingService } from './guest-messaging.service';
import { InboxNotifierService } from './inbox-notifier.service';
import { MailService } from './mail.service';
import { WhatsAppService } from './whatsapp.service';

/**
 * Everything the park sends: the desk's new-booking alert, the guest's ticket
 * (e-mail with QR, WhatsApp) and the evening-before reminder.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Booking, BookingLine]), TicketsModule],
  providers: [MailService, WhatsAppService, BookingNotifierService, GuestMessagingService, InboxNotifierService],
  exports: [MailService, WhatsAppService, BookingNotifierService, GuestMessagingService, InboxNotifierService],
})
export class NotificationsModule {}
