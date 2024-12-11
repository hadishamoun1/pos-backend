import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Thickness } from './thickness.entity';

@Entity()
export class ItemVariant {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Thickness, (thickness) => thickness.variants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  thickness: Thickness; // Reference to the parent Thickness

  @Column('decimal', { precision: 10, scale: 2, nullable: false })
  length: number; // Length of the item

  @Column('decimal', { precision: 10, scale: 2, nullable: false })
  width: number; // Width of the item

  @Column({ type: 'int', nullable: false })
  sheetsPerBox: number; // Number of sheets per box

  @Column({ length: 50, nullable: false })
  origin: string; // Origin of the item
}
