import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Dimension } from './dimension.entity';
import { AdjustedBox } from './adjustedBox.entity';
import { OpenedSheet } from './openedSheet.entity';

@Entity()
export class InventoryTracking {
  @PrimaryGeneratedColumn()
  inventoryId: number; // Unique identifier for each transaction record

  @ManyToOne(() => Dimension)
  dimension: Dimension; // Reference to the item dimension being tracked

  @ManyToOne(() => AdjustedBox, { nullable: true })
  adjustedBox: AdjustedBox | null; // Reference to any adjusted box in the transaction

  @ManyToOne(() => OpenedSheet, { nullable: true })
  openedSheet: OpenedSheet | null; // Reference to any opened sheet entry in the transaction

  @Column({ type: 'int', nullable: true })
  quantityAdded: number | null; // Amount added to inventory, if applicable

  @Column({ type: 'int', nullable: true })
  quantityRemoved: number | null; // Amount removed from inventory, if applicable

  @Column({ type: 'timestamp' })
  transactionDate: Date; // General date of the transaction

  @Column({ type: 'timestamp', nullable: true })
  adjustmentDate: Date | null; // Date when a box was adjusted (e.g., due to damage)

  @Column({ type: 'timestamp', nullable: true })
  boxSoldDate: Date | null; // Date when a full box was sold

  @Column({ type: 'timestamp', nullable: true })
  sheetSoldDate: Date | null; // Date when individual sheets were sold

  @Column({ type: 'timestamp', nullable: true })
  boxOpenedDate: Date | null; // Date when a box was opened for sheet sales

  @Column({ type: 'timestamp', nullable: true })
  addedToInventoryDate: Date | null; // Date when new stock was added to inventory

  @Column()
  transactionType: string; // Type of transaction (e.g., "sale", "open_box", "adjustment", "add_to_inventory")
}
