import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'quotes' })
export class Quote {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'company', type: 'text', default: '' })
  company: string;

  @Column({ name: 'email', type: 'text' })
  email: string;

  @Column({ name: 'phone', type: 'text', default: '' })
  phone: string;

  @Column({ name: 'group_size', type: 'text', default: '' })
  groupSize: string;

  @Column({ name: 'preferred_date', type: 'text', default: '' })
  preferredDate: string;

  @Column({ name: 'message', type: 'text', default: '' })
  message: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
