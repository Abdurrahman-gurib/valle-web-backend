import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'combos' })
export class Combo {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'color', type: 'text' })
  color: string;

  @Column({ name: 'rr_single', type: 'int' })
  rrSingle: number;

  @Column({ name: 'rr_dbl', type: 'int' })
  rrDbl: number;

  @Column({ name: 'nr_single', type: 'int' })
  nrSingle: number;

  @Column({ name: 'nr_dbl', type: 'int' })
  nrDbl: number;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
