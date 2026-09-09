import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'team_pack_items' })
export class TeamPackItem {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'team_pack_id', type: 'int' })
  teamPackId: number;

  @Column({ name: 'text', type: 'text' })
  text: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
