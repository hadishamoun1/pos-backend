import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("warehouses")
export class Warehouse {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 100, unique: true })
  name: string;

  @Column({ type: "boolean", default: false })
  isHome: boolean;
}
