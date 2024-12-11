import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Group {
  @PrimaryGeneratedColumn()
  id: number;
  @Column({ length: 10 })
  groupCode: string; // e.g., G001, G002

  @Column({ length: 50 })
  groupName: string; // e.g., Electronics, Furniture
}
