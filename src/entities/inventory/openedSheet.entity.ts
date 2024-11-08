import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Dimension } from './dimension.entity';

@Entity()
export class OpenedSheet {
  @PrimaryGeneratedColumn()
  openedSheetId: number; // Unique identifier for each entry of opened sheets

  @ManyToOne(() => Dimension, (dimension) => dimension.openedSheets)
  dimension: Dimension; // Reference to the dimension of the opened box

  @Column()
  quantitySheetsAvailable: number; // Number of sheets available from opened boxes

  @Column({ nullable: true })
  location: string; // Storage location for these opened sheets, if applicable
}
