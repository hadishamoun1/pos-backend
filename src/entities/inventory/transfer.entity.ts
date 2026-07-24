// src/entities/inventory/transfer.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { TransferItem } from './transferItem.entity';

export type TransferType = 'Internal' | 'External' | 'Return';

@Entity({ name: 'transfers' })
export class Transfer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50, unique: true })
  transferNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 20 })
  type: TransferType;

  @Column({ length: 100 })
  location: string;

  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  toWarehouse: string | null;

  // optional automatic timestamp of when the record was created
  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
  

  @OneToMany(() => TransferItem, (item) => item.transfer, {
    cascade: true,
    eager: true,
  })
  items: TransferItem[];
}
