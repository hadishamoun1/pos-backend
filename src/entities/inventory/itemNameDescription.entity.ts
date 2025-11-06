import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Item } from './item.entity';
import { ItemVariant } from './itemVariant.entity';

@Entity()
export class ItemNameDescription {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  categoryName: string;

  @Column()
  subCategory: string;

  @Column()
  colorName: string;

  @Column()
  designName: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  itemNumber: string;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  averageCostC: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  averageCostCVM: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  lastCostC: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  lastCostCVM: number;
  
  @Index()
  @Column({ type: 'int', nullable: true, name: 'sort_index_description' })
  sort_index_description: number | null;



}
