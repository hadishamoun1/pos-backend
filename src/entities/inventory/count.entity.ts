

import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
  } from 'typeorm';
  import { ItemVariant } from './itemVariant.entity';
  
  export enum CountType {
    S   = 'S',
    G   = 'G',
    SR  = 'SR',
    RVR = 'RVR',
  }
  
  @Entity({ name: 'inventory_count' })
  export class InventoryCount {
    @PrimaryGeneratedColumn()
    id!: number;
  
    @Column()
    itemVariantId!: number;
  
    @ManyToOne(() => ItemVariant, variant => variant.inventoryCounts, {
      onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'itemVariantId' })
    itemVariant!: ItemVariant;
  
    /** only the date portion, YYYY-MM-DD */
    @Column({ type: 'date' })
    date!: string;
  
    /** counted quantity */
    @Column({ type: 'int' })
    count!: number;
  
    /** one of S, G, SR, RVR */
    @Column({
      type: 'enum',
      enum: CountType,
    })
    type!: CountType;
  }
  