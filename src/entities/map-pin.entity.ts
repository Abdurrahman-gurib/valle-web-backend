import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from './numeric.transformer';

@Entity({ name: 'map_pins' })
export class MapPin {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  /** A..J, GZ, W */
  @Column({ name: 'code', type: 'text' })
  code: string;

  /** % from left */
  @Column({
    name: 'px',
    type: 'numeric',
    precision: 5,
    scale: 1,
    transformer: numericTransformer,
  })
  px: number;

  /** % from top */
  @Column({
    name: 'py',
    type: 'numeric',
    precision: 5,
    scale: 1,
    transformer: numericTransformer,
  })
  py: number;

  @Column({ name: 'kind', type: 'text' })
  kind: 'main' | 'sub';

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'sub', type: 'text', nullable: true })
  sub: string | null;

  @Column({ name: 'image', type: 'text' })
  image: string;

  @Column({ name: 'btn_label', type: 'text', nullable: true })
  btnLabel: string | null;

  @Column({ name: 'experience_id', type: 'text', nullable: true })
  experienceId: string | null;

  /** plan | chamouze | citronelle | kids */
  @Column({ name: 'go_target', type: 'text', nullable: true })
  goTarget: string | null;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
