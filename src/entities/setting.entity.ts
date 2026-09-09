import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'settings' })
export class Setting {
  @PrimaryColumn({ name: 'key', type: 'text' })
  key: string;

  @Column({ name: 'value', type: 'text' })
  value: string;
}
