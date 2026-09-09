import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatConversation, ChatMessage, StaffUser } from '../entities';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { ChatController, StaffChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

/**
 * Live chat: the `/chat` socket namespace plus its REST fallback. StaffAuthModule
 * supplies the same session check the rest of the back office uses.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ChatConversation, ChatMessage, StaffUser]),
    StaffAuthModule,
  ],
  controllers: [ChatController, StaffChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
