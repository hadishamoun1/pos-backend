import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Thickness } from './thickness.entity';
import { ItemNameDescription } from './itemNameDescription.entity';

@Entity()
export class Item {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  itemName: string; // e.g., Clear or Reflective Clear

  @Column({ type: 'enum', enum: ['box', 'sheet', 'sqm','unit'], default: 'box' })
  type: string; // Enum for item type

  // item.entity.ts
  @OneToMany(() => ItemNameDescription, (desc) => desc.item, {
    cascade: ['insert', 'update'],
  })
  descriptions: ItemNameDescription[];

  @OneToMany(() => Thickness, (t) => t.item, { cascade: ['insert', 'update'] })
  thicknesses: Thickness[];
}
