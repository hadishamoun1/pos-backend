import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, CreateDateColumn } from 'typeorm';

@Entity('recording_devices')
export class RecordingDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  pcId: string;

  @Column()
  pcName: string;

  @Column({ default: 'idle' })
  command: string; // idle | recording

  @Column({ default: 'idle' })
  status: string; // idle | recording | offline

  @Column({ type: 'datetime', nullable: true })
  lastSeen: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
