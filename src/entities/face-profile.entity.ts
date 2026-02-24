import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("face_profiles")
export class FaceProfile {
  @PrimaryGeneratedColumn()
  id: number;

  // one face profile per user (simple v1)
  @Index({ unique: true })
  @Column({ type: "int" })
  userId: number;

  // JSON stringified embedding array (e.g. 128 floats)
  @Column({ type: "longtext" })
  embeddingJson: string;

  @Column({ type: "boolean", default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}