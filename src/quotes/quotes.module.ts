import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from '../chat/chat.module';
import { Quote } from '../entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  // The desk hears about a request twice: an e-mail and a toast on the open dashboard.
  imports: [TypeOrmModule.forFeature([Quote]), NotificationsModule, ChatModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
