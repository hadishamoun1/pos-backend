import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Categories } from '../categories.entity';
import { Group } from '../group.entity';
import { Classification } from '../classification.entity';

@Entity()
export class Item {
  @PrimaryGeneratedColumn()
  itemCode: number;

  @Column({ length: 100 })
  itemName: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  length: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  width: number;

  @ManyToOne(() => Categories, { eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoriesId' })
  categories: Categories;

  @ManyToOne(() => Group, { eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @ManyToOne(() => Classification, { eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'classificationId' })
  classification: Classification;

  @Column({ type: 'enum', enum: ['box', 'sheet'], default: 'box' })
  type: string;

  @Column('int', { nullable: true })
  sheetsPerBox: number;

  @Column({ default: false })
  fixBox: boolean;

  @Column({ default: false })
  fixLength: boolean;

  @Column({ default: false })
  fixWidth: boolean;
}
