import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('real_description')
export class RealDescription {
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
  itemNumber: string | null;

  @Index()
  @Column({ type: 'int', nullable: true, name: 'sort_index_real_description' })
  sort_index_real_description: number | null;

}
