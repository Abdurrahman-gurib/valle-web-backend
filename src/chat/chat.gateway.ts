import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Namespace, Socket } from 'socket.io';
import { socketCorsOrigin } from '../config/cors';
import { StaffAuthService } from '../staff/auth/staff-auth.service';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import { ChatConversation } from '../entities';
import { ChatService, Msg } from './chat.service';
import { SocketConversationDto, SocketMessageDto, StartSessionDto } from './dto/chat.dto';

/** Every connected operator. Conversation rooms are `conv:<id>`. */
const STAFF_ROOM = 'staff';

const conversationRoom = (conversationId: string): string =>
  `conv:${conversationId}`;

interface ChatSocketData {
  /** Set at `visitor:hello`; a visitor socket may only touch its own thread. */
  visitorKey?: string;
  /** Convenience copy only: never trusted, every staff action re-verifies. */
  staff?: StaffPrincipal;
}

interface ChatSocket extends Socket {
  data: ChatSocketData;
}

/**
 * The only parts of a socket.io `RemoteSocket` the revocation sweep touches.
 * Structural on purpose: `fetchSockets()` hands back remote handles, and the
 * unit tests hand back plain objects.
 */
interface StaffRoomSocket {
  id: string;
  handshake: { headers: { cookie?: string } };
  data: ChatSocketData;
  disconnect(close: boolean): unknown;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: socketCorsOrigin, credentials: true },
})
export class ChatGateway {
  @WebSocketServer()
  private readonly server: Namespace;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chat: ChatService,
    private readonly auth: StaffAuthService,
  ) {}

  // ------------------------------------------------------------------- visitor

  @SubscribeMessage('visitor:hello')
  async visitorHello(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    try {
      const dto = await parsePayload(StartSessionDto, payload);
      const { conversation, messages } = await this.chat.startSession(
        dto.visitorKey,
        dto.name,
        dto.email,
      );
      client.data.visitorKey = dto.visitorKey;
      await client.join(conversationRoom(conversation.id));
      client.emit('visitor:ready', {
        conversationId: conversation.id,
        messages,
      });
    } catch (err) {
      this.fail(client, err);
    }
  }

  @SubscribeMessage('visitor:message')
  async visitorMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    try {
      const dto = await parsePayload(SocketMessageDto, payload);
      const { conversation, message } = await this.chat.addVisitorMessage(
        dto.conversationId,
        requireVisitorKey(client),
        dto.body,
      );
      // Re-join covers a socket that reconnected without saying hello again.
      await client.join(conversationRoom(conversation.id));
      await this.announceVisitorMessage(conversation, message);
    } catch (err) {
      this.fail(client, err);
    }
  }

  @SubscribeMessage('visitor:typing')
  async visitorTyping(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    try {
      const dto = await parsePayload(SocketConversationDto, payload);
      // Membership of the room already proves ownership (joining requires it),
      // so a keystroke costs no database round trip.
      requireVisitorKey(client);
      if (!client.rooms.has(conversationRoom(dto.conversationId))) {
        throw new ForbiddenException('Not your conversation');
      }
      await this.emitToStaff('peer:typing', {
        conversationId: dto.conversationId,
      });
    } catch (err) {
      this.fail(client, err);
    }
  }

  // --------------------------------------------------------------------- staff

  @SubscribeMessage('staff:hello')
  async staffHello(@ConnectedSocket() client: ChatSocket): Promise<void> {
    try {
      await this.requireStaff(client);
      await client.join(STAFF_ROOM);
      client.emit('staff:ready', {
        conversations: await this.chat.listConversations(),
      });
    } catch (err) {
      this.fail(client, err);
    }
  }

  @SubscribeMessage('staff:open')
  async staffOpen(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    try {
      await this.requireStaff(client);
      const dto = await parsePayload(SocketConversationDto, payload);
      const conversation = await this.chat.markStaffRead(dto.conversationId);
      await client.join(conversationRoom(conversation.id));
      // Also the staff room, so every socket holding conversation data is swept
      // by evictRevokedStaff(). The real client says hello first, so this is a
      // no-op there; it closes the gap for a client that only opens a thread.
      await client.join(STAFF_ROOM);

      const messages = await this.chat.listMessages(conversation.id);
      client.emit('staff:thread', {
        conversationId: conversation.id,
        messages,
      });
      // Clearing the badge is news for every other operator's list. The thread
      // we just read already tells us the preview, so no extra query.
      await this.emitToStaff('conversation:updated', {
        conversation: this.chat.toSummary(
          conversation,
          messages[messages.length - 1]?.body,
        ),
      });
    } catch (err) {
      this.fail(client, err);
    }
  }

  @SubscribeMessage('staff:message')
  async staffMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    try {
      const staff = await this.requireStaff(client);
      const dto = await parsePayload(SocketMessageDto, payload);
      const { conversation, message } = await this.chat.addStaffMessage(
        dto.conversationId,
        staff.id,
        dto.body,
      );
      await client.join(conversationRoom(conversation.id));

      await this.broadcastMessage(conversation.id, message);
      await this.emitToStaff('conversation:updated', {
        conversation: this.chat.toSummary(conversation, message.body),
      });
    } catch (err) {
      this.fail(client, err);
    }
  }

  @SubscribeMessage('staff:close')
  async staffClose(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    try {
      await this.requireStaff(client);
      const dto = await parsePayload(SocketConversationDto, payload);
      const conversation = await this.chat.close(dto.conversationId);
      await this.emitToStaff('conversation:updated', {
        conversation: await this.chat.summaryOf(conversation),
      });
    } catch (err) {
      this.fail(client, err);
    }
  }

  @SubscribeMessage('staff:typing')
  async staffTyping(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    try {
      await this.requireStaff(client);
      const dto = await parsePayload(SocketConversationDto, payload);
      client
        .to(conversationRoom(dto.conversationId))
        .emit('peer:typing', { conversationId: dto.conversationId });
    } catch (err) {
      this.fail(client, err);
    }
  }

  // ------------------------------------------------------------------ broadcast

  /**
   * Fan-out for a visitor message. Also called by the REST fallback route, so a
   * visitor whose socket is blocked still lands live in the back office.
   */
  async announceVisitorMessage(
    conversation: ChatConversation,
    message: Msg,
  ): Promise<void> {
    if (!this.server) return; // no websocket server (unit tests)
    await this.broadcastMessage(conversation.id, message);
    await this.emitToStaff('conversation:updated', {
      conversation: this.chat.toSummary(conversation, message.body),
    });
  }

  /**
   * Fan-out for a staff reply. Called by the REST fallback so an operator whose
   * socket has dropped can still answer and have the visitor see it instantly.
   */
  async announceStaffMessage(
    conversation: ChatConversation,
    message: Msg,
  ): Promise<void> {
    if (!this.server) return; // no websocket server (unit tests)
    await this.broadcastMessage(conversation.id, message);
    await this.emitToStaff('conversation:updated', {
      conversation: this.chat.toSummary(conversation, message.body),
    });
  }

  /** Fan-out for a status change (e.g. a conversation closed over REST). */
  async announceConversation(conversation: ChatConversation): Promise<void> {
    if (!this.server) return;
    await this.emitToStaff('conversation:updated', {
      conversation: this.chat.toSummary(conversation),
    });
  }

  /**
   * One emit to both rooms: socket.io de-duplicates the recipients, so an
   * operator sitting in the thread does not receive the message twice.
   * Revoked operators are dropped first, message bodies being the most
   * sensitive payload we send.
   */
  private async broadcastMessage(
    conversationId: string,
    message: Msg,
  ): Promise<void> {
    if (!this.server) return; // no websocket server (unit tests)
    await this.evictRevokedStaff();
    this.server
      .to(conversationRoom(conversationId))
      .to(STAFF_ROOM)
      .emit('message:new', { conversationId, message });
  }

  /** The single door for staff-room fan-out: sweep first, then emit. */
  private async emitToStaff(event: string, payload: unknown): Promise<void> {
    if (!this.server) return; // no websocket server (unit tests)
    await this.evictRevokedStaff();
    this.server.to(STAFF_ROOM).emit(event, payload);
  }

  // ------------------------------------------------------------------ eviction

  /**
   * How long a passing check is trusted before the socket is re-verified.
   * This IS the exposure bound: a deactivated or demoted operator keeps
   * receiving fan-out for at most this long, then the next broadcast drops
   * them. It exists so a busy room costs one query per operator per window
   * instead of one per operator per message.
   */
  private static readonly STAFF_RECHECK_TTL_MS = 5_000;

  /** socket id → epoch ms until which its last passing check stays valid. */
  private readonly staffCheckedUntil = new Map<string, number>();

  /**
   * `requireStaff()` only gates what an operator SENDS. Membership of the staff
   * room is what decides who RECEIVES guest names, guest emails and message
   * bodies, and nothing ever revoked it: a socket that only listens never
   * re-reads its token, so deactivating or demoting the account left the stream
   * running until the operator happened to disconnect.
   *
   * So every outbound fan-out re-resolves the principal behind each socket in
   * the room and disconnects the ones that no longer qualify. Disconnecting
   * (rather than just leaving the staff room) also clears every `conv:<id>`
   * membership, which is the other half of the leak.
   */
  private async evictRevokedStaff(): Promise<void> {
    if (!this.server) return; // no websocket server (unit tests)
    const sockets = (await this.server
      .in(STAFF_ROOM)
      .fetchSockets()) as unknown as StaffRoomSocket[];
    const now = Date.now();
    await Promise.all(sockets.map((socket) => this.enforceStaff(socket, now)));
    this.forgetDepartedSockets(new Set(sockets.map((socket) => socket.id)));
  }

  /** One socket: cheap cache hit, or a fresh look at the account behind it. */
  private async enforceStaff(
    socket: StaffRoomSocket,
    now: number,
  ): Promise<void> {
    const freshUntil = this.staffCheckedUntil.get(socket.id);
    if (freshUntil !== undefined && freshUntil > now) return;

    let staff: StaffPrincipal | null = null;
    try {
      staff = await this.auth.staffFromCookieHeader(
        socket.handshake.headers.cookie,
      );
    } catch (err) {
      // A database hiccup must not become a licence to keep listening.
      this.logger.error(
        'Staff re-check failed; dropping socket',
        err instanceof Error ? err.stack : String(err),
      );
    }

    if (!staff || !ChatGateway.CHAT_ROLES.has(staff.role)) {
      this.staffCheckedUntil.delete(socket.id);
      socket.data.staff = undefined;
      socket.disconnect(true);
      this.logger.warn(
        `Dropped chat socket ${socket.id}: staff access has been revoked`,
      );
      return;
    }
    socket.data.staff = staff;
    this.staffCheckedUntil.set(
      socket.id,
      now + ChatGateway.STAFF_RECHECK_TTL_MS,
    );
  }

  /** Keeps the memo table bounded by the size of the staff room. */
  private forgetDepartedSockets(live: Set<string>): void {
    for (const id of this.staffCheckedUntil.keys()) {
      if (!live.has(id)) this.staffCheckedUntil.delete(id);
    }
  }

  // -------------------------------------------------------------------- guards

  /** Roles allowed to read and answer visitor conversations. */
  private static readonly CHAT_ROLES = new Set(['agent', 'manager']);

  /**
   * Re-reads the session cookie on every staff action rather than trusting the
   * copy cached at `staff:hello`, so a deactivated operator loses access on
   * their next keystroke instead of at token expiry.
   *
   * Also enforces the role: the REST side restricts these conversations to the
   * reservations team, and the socket must not be a way around that.
   */
  private async requireStaff(client: ChatSocket): Promise<StaffPrincipal> {
    const staff = await this.auth.staffFromCookieHeader(
      client.handshake.headers.cookie,
    );
    if (!staff) {
      client.data.staff = undefined;
      this.staffCheckedUntil.delete(client.id);
      throw new UnauthorizedException('Staff session required');
    }
    if (!ChatGateway.CHAT_ROLES.has(staff.role)) {
      client.data.staff = undefined;
      this.staffCheckedUntil.delete(client.id);
      throw new UnauthorizedException('This account cannot access visitor chat');
    }
    client.data.staff = staff;
    // This lookup is exactly what the sweep would do, so let it count.
    this.staffCheckedUntil.set(
      client.id,
      Date.now() + ChatGateway.STAFF_RECHECK_TTL_MS,
    );
    return staff;
  }

  /** Turns any handler failure into `error`, never a stack trace. */
  private fail(client: ChatSocket, err: unknown): void {
    if (err instanceof HttpException) {
      client.emit('error', { message: err.message });
      return;
    }
    this.logger.error(
      'Chat handler failed',
      err instanceof Error ? err.stack : String(err),
    );
    client.emit('error', { message: 'Chat is unavailable right now' });
  }
}

function requireVisitorKey(client: ChatSocket): string {
  const visitorKey = client.data.visitorKey;
  if (!visitorKey) throw new ForbiddenException('Send visitor:hello first');
  return visitorKey;
}

/**
 * Socket payloads never reach the global ValidationPipe, so validate them here
 * against the same DTOs the REST routes use.
 */
async function parsePayload<T extends object>(
  cls: new () => T,
  payload: unknown,
): Promise<T> {
  const plain =
    typeof payload === 'object' && payload !== null ? payload : {};
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, {
    whitelist: true,
    forbidUnknownValues: false,
  });
  if (errors.length > 0) {
    const first = errors[0];
    const message = first.constraints
      ? Object.values(first.constraints)[0]
      : `Invalid ${first.property}`;
    throw new BadRequestException(message);
  }
  return dto;
}
