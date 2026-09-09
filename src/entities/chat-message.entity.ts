import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ChatSender = 'visitor' | 'staff' | 'system';

@Entity({ name: 'chat_messages' })
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'sender', type: 'text' })
  sender: ChatSender;

  /** Set only for `sender = 'staff'`. */
  @Column({ name: 'staff_user_id', type: 'uuid', nullable: true })
  staffUserId: string | null;

  /** Raw visitor/staff input: render as TEXT, never as HTML. */
  @Column({ name: 'body', type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
