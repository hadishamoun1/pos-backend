import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class Group {
  @PrimaryColumn({ length: 10 })
  groupCode: string; // e.g., G001, G002

  @Column({ length: 50 })
  groupName: string; // e.g., Electronics, Furniture
}
