import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Settings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  year: string; 

  @Column({ default: false })
  isActive: boolean; 
}
