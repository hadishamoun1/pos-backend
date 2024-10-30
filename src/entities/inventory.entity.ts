import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Inventory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column('int')
  length: number;

  @Column('int')
  width: number;

  @Column()
  type: string; // Can be 'sheet' or 'box'

  @Column({ nullable: true })
  sheets: number; // Quantity for 'sheet' items only

  @Column({ nullable: true })
  quantityPerBox: number; // Quantity inside the box for 'box' items only

  @Column()
  totalQuantity: number; // Overall quantity of the item

  @Column()
  origin: string;
}
