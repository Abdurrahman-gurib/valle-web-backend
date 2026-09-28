import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ChatAttachmentKind = 'image' | 'gif' | 'audio' | 'file';

/**
 * A file sent in a chat message: photo, GIF, voice note or document. The bytes
 * live in Postgres (bytea) because the containers have no durable disk; files
 * are capped at a few MB (see chat.service) so the table stays manageable.
 */
@Entity({ name: 'chat_attachments' })
export class ChatAttachment {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'kind', type: 'text' })
  kind: ChatAttachmentKind;

  /** Original file name, sanitised; shown as the download label. */
  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'mime', type: 'text' })
  mime: string;

  @Column({ name: 'size', type: 'int' })
  size: number;

  /** Only loaded by the download route (select: false keeps list queries light). */
  @Column({ name: 'data', type: 'bytea', select: false })
  data: Buffer;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
