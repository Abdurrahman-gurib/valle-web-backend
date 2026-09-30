import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking, BookingLine, Setting, Waiver } from '../entities';
import { TicketService } from './ticket.service';
import { TicketsController } from './tickets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, BookingLine, Setting, Waiver])],
  controllers: [TicketsController],
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketsModule {}
