import { Entity, Column, PrimaryGeneratedColumn, OneToMany, Index } from 'typeorm';
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
  
  @Column({ type: 'enum', enum: ['SQM', 'QTY', 'NONE'], default: 'SQM' })
stockMode: 'SQM' | 'QTY' | 'NONE';



    // NEW: controls display order of items globally
  @Index()
  @Column({ type: 'int', nullable: true, name: 'sort_index' })
  sortIndex: number | null;


  @OneToMany(() => Thickness, (t) => t.item, { cascade: ['insert', 'update'] })
  thicknesses: Thickness[];
}
