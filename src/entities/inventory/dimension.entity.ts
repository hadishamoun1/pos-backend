import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Item } from './item.entity';
import { AdjustedBox } from './adjustedBox.entity';
import { OpenedSheet } from './openedSheet.entity';
import { PurchaseItem } from '../purchaseItem.entity';

@Entity()
export class Dimension {
  @PrimaryGeneratedColumn()
  dimensionId: number; // Unique identifier for each dimension variant
  @ManyToOne(() => Item, (item) => item.dimensions, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'itemId' })
  item: Item;

  @Column()
  length: number; // Length of the item in cm (e.g., 225)

  @Column()
  width: number; // Width of the item in cm (e.g., 321)

  @Column()
  sheetsPerBox: number; // Number of sheets per unopened box for this dimension

  @Column({ nullable: true })
  quantityUnopenedBoxes: number; // Quantity of unopened boxes available for this dimension

  @Column()
  origin: string; // Origin of this specific dimension (e.g., "China")

  @OneToMany(() => AdjustedBox, (adjustedBox) => adjustedBox.dimension)
  adjustedBoxes: AdjustedBox[]; // Collection of adjusted boxes for this dimension

  @OneToMany(() => OpenedSheet, (openedSheet) => openedSheet.dimension)
  openedSheets: OpenedSheet[]; // Collection of opened sheets for individual sale

  @OneToMany(() => PurchaseItem, (purchaseItem) => purchaseItem.dimension)
  purchaseItems: PurchaseItem[]; // Collection of purchase items referencing this dimension
}
