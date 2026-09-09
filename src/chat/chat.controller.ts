import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentStaff } from '../staff/auth/current-staff.decorator';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import { ChatGateway } from './chat.gateway';
import { ChatService, ConversationSummary, Msg } from './chat.service';
import {
  PostStaffMessageDto,
  PostVisitorMessageDto,
  StaffConversationsQueryDto,
  StartSessionDto,
  VisitorKeyQueryDto,
} from './dto/chat.dto';

/**
 * New conversations: 10 per 10 minutes per IP. Resuming costs nothing extra,
 * since `startSession` reuses the open conversation the `visitorKey` already
 * owns, so a guest who reloads the page or switches device keeps hitting the
 * same thread. The budget therefore only bites on genuinely new visitor keys,
 * of which one household produces a handful at most, while it stops a script
 * from opening thousands of empty threads in the operators' queue.
 */
const SESSION_LIMIT = 10;
const SESSION_TTL_MS = 600_000;

/**
 * REST fallback for the widget: first paint, and everything the visitor does
 * when the websocket cannot connect. Public: the `visitorKey` is the only
 * credential, so every route re-checks that it owns the conversation.
 */
@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Post('session')
  @HttpCode(200)
  // Public write: capped per IP so nobody can flood the back office with
  // empty conversations. Route-scoped, so reading a thread stays unmetered.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: SESSION_LIMIT, ttl: SESSION_TTL_MS } })
  @ApiOperation({ summary: 'Open (or resume) the visitor’s conversation' })
  @ApiResponse({ status: 429, description: 'Too many sessions (10 / 10 min)' })
  async startSession(
    @Body() dto: StartSessionDto,
  ): Promise<{ conversationId: string; messages: Msg[] }> {
    const { conversation, messages } = await this.chat.startSession(
      dto.visitorKey,
      dto.name,
      dto.email,
    );
    return { conversationId: conversation.id, messages };
  }

  @Get('session/:conversationId/messages')
  @ApiOperation({ summary: 'Full thread for a conversation the key owns' })
  @ApiResponse({ status: 403, description: 'visitorKey does not own it' })
  @ApiResponse({ status: 404, description: 'No such conversation' })
  async messages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: VisitorKeyQueryDto,
  ): Promise<{ messages: Msg[] }> {
    await this.chat.assertVisitorOwns(conversationId, query.visitorKey);
    return { messages: await this.chat.listMessages(conversationId) };
  }

  @Post('session/:conversationId/messages')
  // Public write path: capped per IP so nobody can flood the back office.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Post a visitor message' })
  @ApiResponse({ status: 403, description: 'visitorKey does not own it' })
  @ApiResponse({ status: 429, description: 'Too many messages (20 / 60 s)' })
  async postMessage(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: PostVisitorMessageDto,
  ): Promise<{ message: Msg }> {
    const { conversation, message } = await this.chat.addVisitorMessage(
      conversationId,
      dto.visitorKey,
      dto.body,
    );
    // Operators are usually on a socket even when the visitor is not.
    await this.gateway.announceVisitorMessage(conversation, message);
    return { message };
  }
}

/**
 * Back office. Mirrors the `staff:*` socket events over REST so an operator
 * whose websocket has dropped can still read a thread AND reply: "reply
 * instantly" must not depend on a healthy socket. Writes still fan out over the
 * gateway, so a visitor who IS connected sees the answer immediately.
 */
@ApiTags('staff-chat')
@Controller('staff/chat')
// Visitor conversations carry guest questions and contact details, so they are
// restricted to the reservations roles rather than any signed-in operator.
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('agent', 'manager')
export class StaffChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: 'Conversations, newest activity first' })
  @ApiResponse({ status: 401, description: 'No valid session' })
  async conversations(
    @Query() query: StaffConversationsQueryDto,
  ): Promise<{ items: ConversationSummary[] }> {
    return { items: await this.chat.listConversations(query.status) };
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Full thread for any conversation' })
  @ApiResponse({ status: 401, description: 'No valid session' })
  async messages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ messages: Msg[] }> {
    await this.chat.markStaffRead(conversationId);
    return { messages: await this.chat.listMessages(conversationId) };
  }

  @Post('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Reply to a visitor (socket-free fallback)' })
  @ApiResponse({ status: 401, description: 'No valid session' })
  @ApiResponse({ status: 404, description: 'No such conversation' })
  async reply(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: PostStaffMessageDto,
    @CurrentStaff() staff: StaffPrincipal,
  ): Promise<{ message: Msg }> {
    const { conversation, message } = await this.chat.addStaffMessage(
      conversationId,
      staff.id,
      dto.body,
    );
    await this.gateway.announceStaffMessage(conversation, message);
    return { message };
  }

  @Post('conversations/:conversationId/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a conversation' })
  @ApiResponse({ status: 401, description: 'No valid session' })
  @ApiResponse({ status: 404, description: 'No such conversation' })
  async close(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ ok: true }> {
    const conversation = await this.chat.close(conversationId);
    await this.gateway.announceConversation(conversation);
    return { ok: true };
  }
}
