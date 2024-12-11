import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class Categories {
  @PrimaryColumn({ length: 10 })
  categoriesCode: string; // e.g., CAT001, CAT002

  @Column({ length: 50 })
  categoriesName: string; // e.g., Appliances, Tools
}
