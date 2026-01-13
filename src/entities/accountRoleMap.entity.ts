import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('account_role_map')
@Index(['role', 'currencyCode'], { unique: true })
export class AccountRoleMap {
  @PrimaryGeneratedColumn()
  id: number;

  // e.g. SALES_VAT, VAT_OUTPUT, SALES_NO_VAT, AR_CUSTOMER, AP_SUPPLIER...
  @Column({ type: 'varchar', length: 50 })
  role: string;

  // 'USD', 'LL' ... or NULL for default
  @Column({ type: 'varchar', length: 10, nullable: true })
  currencyCode: string | null;

  // we store accountNumber to keep it portable across DBs
  @Column({ type: 'varchar', length: 50 })
  accountNumber: string;
}
