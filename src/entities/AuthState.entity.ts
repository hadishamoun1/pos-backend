import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('auth_state')
export class AuthState {
  @PrimaryColumn()
  id: number; // always 1

  @Column({ type: 'int', default: 1 })
  globalTokenVersion: number;

  @Column({ type: 'boolean', default: false })
  isLocked: boolean;

  @Column({ type: 'int', nullable: true })
  lockAllowedUserId: number | null;
}
