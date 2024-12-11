import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Classification {
  @PrimaryGeneratedColumn()
  id: number;
  @Column({ length: 10 })
  classificationCode: string; // e.g., C001, C002

  @Column({ length: 50 })
  classificationName: string; // e.g., Domestic, Industrial
}
