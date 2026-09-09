import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'chat_conversations' })
export class ChatConversation {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  /** Opaque id held in the visitor's browser (localStorage). */
  @Column({ name: 'visitor_key', type: 'text' })
  visitorKey: string;

  @Column({ name: 'visitor_name', type: 'text', default: '' })
  visitorName: string;

  @Column({ name: 'visitor_email', type: 'text', default: '' })
  visitorEmail: string;

  @Column({ name: 'subject', type: 'text', default: '' })
  subject: string;

  @Column({ name: 'status', type: 'text', default: 'open' })
  status: 'open' | 'closed';

  @Column({ name: 'assigned_to', type: 'uuid', nullable: true })
  assignedTo: string | null;

  /** Messages awaiting a staff reply. */
  @Column({ name: 'unread_staff', type: 'int', default: 0 })
  unreadStaff: number;

  /** Replies the visitor has not seen. */
  @Column({ name: 'unread_visitor', type: 'int', default: 0 })
  unreadVisitor: number;

  @Column({ name: 'last_message_at', type: 'timestamptz' })
  lastMessageAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
