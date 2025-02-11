import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    OneToMany,
    ManyToOne,
    JoinColumn,
  } from "typeorm";
  import { RequestDetail } from "./requestDetails.entity";
  import { Customer } from "./customer.entity"; // Import Customer entity
  
  @Entity("requests")
  export class Request {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({ type: "date" })
    requestDate: Date;
  
    @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
    totalAmount: number;
  
    @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
    vatAmount: number;
  
    @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
    grandTotal: number;
  
    @OneToMany(() => RequestDetail, (detail) => detail.request, { cascade: true })
    details: RequestDetail[];
  
    // ✅ Link request to customer
    @Column({ type: "int" })
    customerId: number;
  
    @ManyToOne(() => Customer, (customer) => customer.requests, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({ name: "customerId" })
    customer: Customer;
  
    @CreateDateColumn()
    createdAt: Date;
  }
  