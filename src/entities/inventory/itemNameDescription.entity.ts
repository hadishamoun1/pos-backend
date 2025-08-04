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

  @Column({ type: 'varchar', length: 50,  nullable: true })
  itemNumber: string;

  @ManyToOne(() => Item, (item) => item.descriptions, {
    onDelete: 'CASCADE',
  })
  item: Item;

  @Column()
  itemId: number;
}
