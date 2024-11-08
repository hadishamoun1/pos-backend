import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Dimension } from './dimension.entity';

@Entity()
export class AdjustedBox {
  @PrimaryGeneratedColumn()
  adjustedBoxId: number; // Unique identifier for each adjusted box

  @ManyToOne(() => Dimension, (dimension) => dimension.adjustedBoxes)
  dimension: Dimension; // Reference to the specific dimension this adjusted box belongs to

  @Column()
  adjustedSheetsPerBox: number; // Number of usable sheets in this box (e.g., 29 if 1 sheet is damaged)

  @Column()
  quantityAdjustedBoxes: number; // Number of boxes with adjusted sheet counts

  @Column()
  status: string; // Status of the box, e.g., "available" or "sold"

  @Column({ nullable: true })
  notes: string; // Optional notes, such as reason for the adjustment
}
