import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
  } from 'typeorm';
  import { Account } from '../account.entity';
  import { CurrencyRate } from '../currencyRate.entity';
  import { DebitNote } from './debitNote.entity';
  
  @Entity('debit_note_details')
  export class DebitNoteDetail {
    @PrimaryGeneratedColumn()
    id: number;
  
    @ManyToOne(() => DebitNote, (note) => note.details, {
      onDelete: 'CASCADE',
    })
    debitNote: DebitNote;
  
    @ManyToOne(() => Account, { nullable: false })
    account: Account;
  
    @Column({ type: 'varchar', length: 50, nullable: true })
    checkNumber: string;
  
    @Column({ type: 'date', nullable: true })
    checkDate: Date;
  
    @Column({ type: 'varchar', length: 255, nullable: true })
    bankName: string;
  
    @Column({ type: 'varchar', length: 255, nullable: true })
    description: string;
  
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    dr: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    drUSD: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    drLL: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    cr: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    crUSD: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    crLL: number;
  
    @ManyToOne(() => CurrencyRate, { nullable: false })
    exchangeRateAcc: CurrencyRate;
  
    @ManyToOne(() => CurrencyRate, { nullable: false })
    exchangeRateUSD: CurrencyRate;
  }
  