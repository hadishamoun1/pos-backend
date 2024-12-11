import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToMany,
} from 'typeorm';
import { Thickness } from './thickness.enitity';

@Entity()
export class Item {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  itemName: string; // e.g., Clear or Reflective Clear

  @Column({ type: 'enum', enum: ['box', 'sheet'], default: 'box' })
  type: string; // Enum for item type

  @OneToMany(() => Thickness, (thickness) => thickness.item, { cascade: true })
  thicknesses: Thickness[]; // Relationship to Thickness
}
