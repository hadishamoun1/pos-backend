import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('recordings')
export class Recording {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  pcId: string;

  @Column()
  pcName: string;

  @Column()
  filename: string;

  @Column({ type: 'bigint', default: 0 })
  fileSize: number;

  @Column({ type: 'datetime', nullable: true })
  recordedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
