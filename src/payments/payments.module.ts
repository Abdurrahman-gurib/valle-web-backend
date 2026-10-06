import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking, BookingAudit, BookingLine, Payment } from '../entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { TicketsModule } from '../tickets/tickets.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Online payment through a hosted checkout (PAYMENT_PROVIDER: none | sandbox;
 * a real gateway adapter is added here when the merchant account exists).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment, Booking, BookingLine, BookingAudit]), TicketsModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
