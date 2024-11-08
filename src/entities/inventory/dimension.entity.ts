import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';
import { Item } from './item.entity';
import { AdjustedBox } from './adjustedBox.entity'
import { OpenedSheet } from './openedSheet.entity';

@Entity()
export class Dimension {
  @PrimaryGeneratedColumn()
  dimensionId: number; // Unique identifier for each dimension variant

  @ManyToOne(() => Item, (item) => item.dimensions)
  item: Item; // Reference to the parent item

  @Column()
  length: number; // Length of the item in cm (e.g., 225)

  @Column()
  width: number; // Width of the item in cm (e.g., 321)

  @Column()
  sheetsPerBox: number; // Number of sheets per box for this dimension

  @Column()
  quantityUnopenedBoxes: number; // Total unopened boxes available for this dimension

  @OneToMany(() => AdjustedBox, (adjustedBox) => adjustedBox.dimension)
  adjustedBoxes: AdjustedBox[]; // Collection of boxes with adjusted sheet counts

  @OneToMany(() => OpenedSheet, (openedSheet) => openedSheet.dimension)
  openedSheets: OpenedSheet[]; // Collection of opened boxes where sheets are sold individually
}
