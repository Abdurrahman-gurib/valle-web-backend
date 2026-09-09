import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'team_packs' })
export class TeamPack {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'image', type: 'text' })
  image: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
