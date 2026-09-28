import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChatAttachment, ChatConversation, ChatMessage, StaffUser } from '../entities';
import type { ChatAttachmentKind } from '../entities/chat-attachment.entity';
import type { ChatSender } from '../entities/chat-message.entity';

/** Contract shape: one file on a message. The bytes come from the attachment routes. */
export interface MsgAttachment {
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  mime: string;
  size: number;
}

/** Contract shape: one chat message as the frontend consumes it. */
export interface Msg {
  id: string;
  conversationId: string;
  sender: ChatSender;
  staffName?: string;
  body: string;
  createdAt: string;
  attachments?: MsgAttachment[];
}

/** What can be sent in chat, and how big. Anything else is refused with a 400. */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_MIMES: Record<string, ChatAttachmentKind> = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/heic': 'image', 'image/gif': 'gif',
  'audio/webm': 'audio', 'audio/ogg': 'audio', 'audio/mpeg': 'audio', 'audio/mp4': 'audio', 'audio/x-m4a': 'audio', 'audio/wav': 'audio', 'audio/aac': 'audio',
  'application/pdf': 'file', 'text/plain': 'file', 'text/csv': 'file',
  'application/msword': 'file', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'file',
  'application/vnd.ms-excel': 'file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'file',
  'application/vnd.ms-powerpoint': 'file', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'file',
};
export interface UploadedChatFile { originalname: string; mimetype: string; size: number; buffer: Buffer }

/** The browser sets a codec-suffixed type for recordings ("audio/webm;codecs=opus"). */
export function attachmentKind(mime: string): ChatAttachmentKind | null {
  const base = mime.split(';')[0].trim().toLowerCase();
  return ATTACHMENT_MIMES[base] ?? null;
}

/** File names are shown back to people: strip path parts and control characters. */
export function safeFileName(name: string, fallback: string): string {
  const base = (name || '').split(/[\\/]/).pop() || '';
  const clean = base.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120);
  return clean || fallback;
}

/** Contract shape: one row of the back-office conversation list. */
export interface ConversationSummary {
  id: string;
  visitorName: string;
  visitorEmail: string;
  subject: string;
  status: 'open' | 'closed';
  unreadStaff: number;
  lastMessageAt: string;
  createdAt: string;
  lastMessage?: string;
}

export interface StartedSession {
  conversation: ChatConversation;
  messages: Msg[];
}

export interface PostedMessage {
  conversation: ChatConversation;
  message: Msg;
}

export type ConversationStatus = 'open' | 'closed';

/** List previews stay short enough to render on one line. */
const LAST_MESSAGE_MAX = 120;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/**
 * Every read, write and access check for live chat. The gateway and the REST
 * controllers both go through here so a socket client and an HTTP client can
 * never be authorised differently.
 */
@Injectable()
export class ChatService {
  /**
   * Operator display names, memoised for the process lifetime. A staff name
   * changes far more rarely than a thread is read, and this is what keeps
   * message mapping off the N+1 path.
   */
  private readonly staffNames = new Map<string, string>();

  constructor(
    @InjectRepository(ChatConversation)
    private readonly convRepo: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    @InjectRepository(StaffUser)
    private readonly staffRepo: Repository<StaffUser>,
    @InjectRepository(ChatAttachment)
    private readonly attachmentRepo: Repository<ChatAttachment>,
  ) {}

  // -------------------------------------------------------------- attachments

  /**
   * A photo, GIF, voice note or document, sent as its own message (the caption
   * is the message body). Same counters as a text message, so the back office
   * sees the unread badge and the visitor the reply dot.
   */
  async addAttachment(
    conversationId: string,
    sender: 'visitor' | 'staff',
    staffUserId: string | null,
    file: UploadedChatFile | undefined,
    caption = '',
    visitorKey?: string,
  ): Promise<PostedMessage> {
    if (!file || !file.buffer?.length) throw new BadRequestException('No file received');
    if (file.size > ATTACHMENT_MAX_BYTES || file.buffer.length > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(`File too large: at most ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB`);
    }
    const kind = attachmentKind(file.mimetype);
    if (!kind) throw new BadRequestException(`Files of type ${file.mimetype || 'unknown'} cannot be sent here`);

    const conversation = sender === 'visitor'
      ? await this.assertVisitorOwns(conversationId, visitorKey ?? '')
      : await this.requireConversation(conversationId);

    // One transaction: a message never exists without its file, nor the reverse.
    const { message, att } = await this.messageRepo.manager.transaction(async (m) => {
      const message = await m.save(
        m.create(ChatMessage, { conversationId: conversation.id, sender, staffUserId, body: caption.trim().slice(0, 2000) }),
      );
      const att = await m.save(
        m.create(ChatAttachment, {
          messageId: message.id,
          conversationId: conversation.id,
          kind,
          name: safeFileName(file.originalname, kind === 'audio' ? 'voice-note.webm' : kind + '-' + message.id.slice(0, 8)),
          mime: file.mimetype.split(';')[0].trim().toLowerCase(),
          size: file.buffer.length,
          data: file.buffer,
        }),
      );
      return { message, att };
    });
    await this.convRepo.update(
      { id: conversation.id },
      sender === 'visitor'
        ? { unreadStaff: () => 'unread_staff + 1', lastMessageAt: message.createdAt ?? new Date() }
        : { unreadStaff: 0, unreadVisitor: () => 'unread_visitor + 1', lastMessageAt: message.createdAt ?? new Date() },
    );
    await this.cacheStaffNames([message]);
    return {
      conversation: await this.requireConversation(conversation.id),
      message: this.toMsg(message, [att]),
    };
  }

  /** Bytes of one attachment; `visitorKey` must own the conversation unless staff asks. */
  async getAttachment(id: string, visitorKey?: string): Promise<ChatAttachment> {
    this.assertUuid(id);
    const att = await this.attachmentRepo
      .createQueryBuilder('a')
      .addSelect('a.data')
      .where('a.id = :id', { id })
      .getOne();
    if (!att) throw new NotFoundException('Attachment not found');
    if (visitorKey !== undefined) await this.assertVisitorOwns(att.conversationId, visitorKey);
    return att;
  }

  /** Map messages to the contract shape with their attachments in one query. */
  private async withAttachments(messages: ChatMessage[]): Promise<Msg[]> {
    if (messages.length === 0) return [];
    const atts = await this.attachmentRepo.find({
      where: { messageId: In(messages.map((m) => m.id)) },
      order: { createdAt: 'ASC' },
    });
    const byMessage = new Map<string, ChatAttachment[]>();
    for (const a of atts) byMessage.set(a.messageId, [...(byMessage.get(a.messageId) ?? []), a]);
    return messages.map((m) => this.toMsg(m, byMessage.get(m.id)));
  }

  // --------------------------------------------------------------- visitor side

  /**
   * The visitor's live thread: their open conversation, or a fresh one when
   * they have none (a closed conversation is never resumed).
   */
  async startSession(
    visitorKey: string,
    name?: string,
    email?: string,
  ): Promise<StartedSession> {
    const existing = await this.convRepo.findOne({
      where: { visitorKey, status: 'open' },
      order: { lastMessageAt: 'DESC' },
    });

    if (existing) {
      // A visitor who fills in their details mid-conversation should become
      // identifiable in the back office straight away.
      const patch: Partial<ChatConversation> = {};
      const nextName = (name ?? '').trim();
      const nextEmail = (email ?? '').trim();
      if (nextName && nextName !== existing.visitorName) {
        patch.visitorName = nextName;
      }
      if (nextEmail && nextEmail !== existing.visitorEmail) {
        patch.visitorEmail = nextEmail;
      }
      if (Object.keys(patch).length > 0) {
        await this.convRepo.update({ id: existing.id }, patch);
        Object.assign(existing, patch);
      }
      return {
        conversation: existing,
        messages: await this.listMessages(existing.id),
      };
    }

    const conversation = await this.convRepo.save(
      this.convRepo.create({
        visitorKey,
        visitorName: (name ?? '').trim(),
        visitorEmail: (email ?? '').trim(),
        lastMessageAt: new Date(),
      }),
    );
    return { conversation, messages: [] };
  }

  /**
   * The only authorisation a visitor has. Call it before every public read or
   * write: a visitorKey may only ever touch its own conversation.
   */
  async assertVisitorOwns(
    conversationId: string,
    visitorKey: string,
  ): Promise<ChatConversation> {
    const conversation = await this.requireConversation(conversationId);
    if (conversation.visitorKey !== visitorKey) {
      throw new ForbiddenException('This conversation belongs to someone else');
    }
    return conversation;
  }

  async addVisitorMessage(
    conversationId: string,
    visitorKey: string,
    body: string,
  ): Promise<PostedMessage> {
    const conversation = await this.assertVisitorOwns(conversationId, visitorKey);
    const message = await this.messageRepo.save(
      this.messageRepo.create({
        conversationId: conversation.id,
        sender: 'visitor',
        staffUserId: null,
        body,
      }),
    );

    // Incremented in SQL rather than read-modify-written, so two messages
    // landing at once both count.
    await this.convRepo.update(
      { id: conversation.id },
      {
        unreadStaff: () => 'unread_staff + 1',
        lastMessageAt: message.createdAt ?? new Date(),
      },
    );

    return {
      conversation: await this.requireConversation(conversation.id),
      message: this.toMsg(message),
    };
  }

  // ----------------------------------------------------------------- staff side

  /**
   * Persists an operator reply. The caller is responsible for having
   * authenticated `staffUserId` (StaffAuthGuard, or the gateway's re-check).
   */
  async addStaffMessage(
    conversationId: string,
    staffUserId: string,
    body: string,
  ): Promise<PostedMessage> {
    const conversation = await this.requireConversation(conversationId);
    const message = await this.messageRepo.save(
      this.messageRepo.create({
        conversationId: conversation.id,
        sender: 'staff',
        staffUserId,
        body,
      }),
    );

    // Replying is itself the acknowledgement, so the staff backlog clears.
    await this.convRepo.update(
      { id: conversation.id },
      {
        unreadStaff: 0,
        unreadVisitor: () => 'unread_visitor + 1',
        lastMessageAt: message.createdAt ?? new Date(),
      },
    );

    await this.cacheStaffNames([message]);
    return {
      conversation: await this.requireConversation(conversation.id),
      message: this.toMsg(message),
    };
  }

  /**
   * The back-office list. The preview comes from a correlated sub-select rather
   * than a follow-up query per row, so the cost stays one round trip whatever
   * the conversation count.
   */
  async listConversations(
    status?: ConversationStatus,
  ): Promise<ConversationSummary[]> {
    const qb = this.convRepo
      .createQueryBuilder('c')
      .addSelect(
        (sub) =>
          sub
            .select("COALESCE(NULLIF(m.body, ''), '[file]')")
            .from(ChatMessage, 'm')
            .where('m.conversationId = c.id')
            .orderBy('m.createdAt', 'DESC')
            .limit(1),
        'lastMessage',
      )
      .orderBy('c.lastMessageAt', 'DESC');
    if (status) qb.where('c.status = :status', { status });

    // No joins, so raw rows line up one-for-one with the hydrated entities.
    const { entities, raw } = await qb.getRawAndEntities<{
      lastMessage: string | null;
    }>();
    return entities.map((c, i) =>
      this.toSummary(c, raw[i]?.lastMessage ?? undefined),
    );
  }

  async markStaffRead(conversationId: string): Promise<ChatConversation> {
    const conversation = await this.requireConversation(conversationId);
    if (conversation.unreadStaff !== 0) {
      await this.convRepo.update({ id: conversation.id }, { unreadStaff: 0 });
      conversation.unreadStaff = 0;
    }
    return conversation;
  }

  async close(conversationId: string): Promise<ChatConversation> {
    const conversation = await this.requireConversation(conversationId);
    if (conversation.status !== 'closed') {
      await this.convRepo.update(
        { id: conversation.id },
        { status: 'closed' },
      );
      conversation.status = 'closed';
    }
    return conversation;
  }

  // ---------------------------------------------------------------- shared reads

  async listMessages(conversationId: string): Promise<Msg[]> {
    this.assertUuid(conversationId);
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
    await this.cacheStaffNames(messages);
    return this.withAttachments(messages);
  }

  /** Summary for a single conversation, preview included. */
  async summaryOf(
    conversation: ChatConversation,
  ): Promise<ConversationSummary> {
    const newest = await this.messageRepo.findOne({
      where: { conversationId: conversation.id },
      order: { createdAt: 'DESC' },
    });
    return this.toSummary(conversation, newest?.body);
  }

  // -------------------------------------------------------------------- mappers

  toSummary(
    conversation: ChatConversation,
    lastMessageBody?: string,
  ): ConversationSummary {
    const summary: ConversationSummary = {
      id: conversation.id,
      visitorName: conversation.visitorName,
      visitorEmail: conversation.visitorEmail,
      subject: conversation.subject ?? '',
      status: conversation.status,
      unreadStaff: conversation.unreadStaff,
      lastMessageAt: iso(conversation.lastMessageAt),
      createdAt: iso(conversation.createdAt),
    };
    if (lastMessageBody) summary.lastMessage = preview(lastMessageBody);
    return summary;
  }

  toMsg(message: ChatMessage, attachments?: ChatAttachment[]): Msg {
    const msg: Msg = {
      id: message.id,
      conversationId: message.conversationId,
      sender: message.sender,
      body: message.body,
      createdAt: iso(message.createdAt),
    };
    if (attachments && attachments.length > 0) {
      msg.attachments = attachments.map((a) => ({ id: a.id, kind: a.kind, name: a.name, mime: a.mime, size: a.size }));
    }
    const staffName = message.staffUserId
      ? this.staffNames.get(message.staffUserId)
      : undefined;
    if (staffName) msg.staffName = staffName;
    return msg;
  }

  // -------------------------------------------------------------------- helpers

  private async requireConversation(id: string): Promise<ChatConversation> {
    this.assertUuid(id);
    const conversation = await this.convRepo.findOne({ where: { id } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  /**
   * Postgres rejects a malformed uuid with 22P02 before it ever looks for a
   * row, so screen the id here and treat a bad one as simply absent.
   */
  private assertUuid(id: string): void {
    if (!UUID_PATTERN.test(id ?? '')) {
      throw new NotFoundException('Conversation not found');
    }
  }

  /** Fills `staffNames` for any operator these messages reference. */
  private async cacheStaffNames(messages: ChatMessage[]): Promise<void> {
    const missing = [
      ...new Set(
        messages
          .filter((m) => m.sender === 'staff' && m.staffUserId)
          .map((m) => m.staffUserId as string),
      ),
    ].filter((id) => !this.staffNames.has(id));
    if (missing.length === 0) return;

    const users = await this.staffRepo.find({
      where: { id: In(missing) },
      select: ['id', 'name'],
    });
    for (const user of users) this.staffNames.set(user.id, user.name);
  }
}

/** One-line preview: newlines flattened, clipped to LAST_MESSAGE_MAX. */
function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > LAST_MESSAGE_MAX
    ? `${flat.slice(0, LAST_MESSAGE_MAX - 1)}…`
    : flat;
}
