import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'categories' })
export class Category {
  /** adventure | nature | kids | tours */
  @PrimaryColumn({ name: 'id', type: 'text' })
  id: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'badge', type: 'text' })
  badge: string;

  @Column({ name: 'color', type: 'text' })
  color: string;

  @Column({ name: 'fg', type: 'text' })
  fg: string;

  @Column({ name: 'pulse', type: 'text' })
  pulse: string;
}
