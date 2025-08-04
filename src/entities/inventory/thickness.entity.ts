import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Item } from './item.entity';
import { ItemVariant } from './itemVariant.entity';

@Entity()
export class Thickness {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Item, (item) => item.thicknesses, { onDelete: 'CASCADE' })
  @JoinColumn()
  item: Item; // Reference to the parent Item

  @Column('decimal', { precision: 5, scale: 2, nullable: false })
  thickness: number; // e.g., 8mm, 10mm, 5.5mm



  @OneToMany(() => ItemVariant, (v) => v.thickness, { cascade: ['insert'] })
  variants: ItemVariant[];
}
