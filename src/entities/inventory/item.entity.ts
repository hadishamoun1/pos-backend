import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Dimension } from './dimension.entity';

@Entity()
export class Item {
  @PrimaryGeneratedColumn()
  itemId: number; // Unique identifier for each item

  @Column()
  itemName: string; // Name of the item (e.g., "5.5mm Clear")

  @Column()
  type: string; // Type of item, such as "box" or "sheet"

  @OneToMany(() => Dimension, (dimension) => dimension.item)
  dimensions: Dimension[]; // Various dimensions (length, width, origin) available for this item
}
