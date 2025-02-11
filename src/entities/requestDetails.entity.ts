import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
  } from "typeorm";
  import { Request } from "./request.entity";
  
  @Entity("request_details")
  export class RequestDetail {
    @PrimaryGeneratedColumn()
    id: number;
  
    @ManyToOne(() => Request, (request) => request.details, { onDelete: "CASCADE" })
    request: Request;
  
    @Column()
    itemName: string;
  
    @Column()
    origin: string;
  
    @Column({ type: "decimal", precision: 10, scale: 2 })
    length: number;
  
    @Column({ type: "decimal", precision: 10, scale: 2 })
    width: number;
  
    @Column({ type: "enum", enum: ["box", "sheet"] })
    type: "box" | "sheet";
  
    @Column({ type: "int", nullable: true }) // Only applicable for boxes
    box: number;
  
    @Column({ type: "int", nullable: true }) // Only applicable for boxes
    sheetPerBox: number;
  
    @Column({ type: "int", nullable: true }) // Only applicable for sheets
    sheet: number;
  
    @Column({ type: "decimal", precision: 10, scale: 2 })
    sqm: number;
  
    @Column({ type: "decimal", precision: 10, scale: 2 })
    price: number;
  
    @Column({ type: "decimal", precision: 10, scale: 2 })
    total: number;
  }
  