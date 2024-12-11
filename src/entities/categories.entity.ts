import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Categories {
  @PrimaryGeneratedColumn()
  id: number;
  @Column({ length: 10 })
  categoriesCode: string; // e.g., CAT001, CAT002

  @Column({ length: 50 })
  categoriesName: string; // e.g., Appliances, Tools
}
