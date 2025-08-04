import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
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

  @ManyToOne(() => Item, (item) => item.descriptions, {
    onDelete: 'CASCADE',
  })
  item: Item;

  @Column()
  itemId: number;
}
