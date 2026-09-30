import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** A code the guest types on the website, or staff apply: percent / amount off, FOC, free entry. */
@Entity({ name: 'coupons' })
export class Coupon {
  @PrimaryColumn({ name: 'code', type: 'text' })
  code: string;

  @Column({ name: 'kind', type: 'text' })
  kind: 'percent' | 'amount' | 'foc' | 'entry_free';

  @Column({ name: 'value', type: 'int', default: 0 })
  value: number;

  @Column({ name: 'note', type: 'text', default: '' })
  note: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom: string | null;

  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo: string | null;

  @Column({ name: 'max_uses', type: 'int', nullable: true })
  maxUses: number | null;

  @Column({ name: 'uses', type: 'int', default: 0 })
  uses: number;

  @Column({ name: 'created_by', type: 'text', default: '' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
