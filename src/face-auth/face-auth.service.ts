import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";

import { FaceProfile } from "../entities/face-profile.entity";
import { UsersService } from "../user/user.service"; // <-- adjust if your file is users.service.ts
import { AuthService } from "../auth/auth.service";

@Injectable()
export class FaceAuthService {
  // Start strict; tune after real testing with your office camera/lighting
  private readonly MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.88);

  constructor(
    @InjectRepository(FaceProfile)
    private readonly faceRepo: Repository<FaceProfile>,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  private parseEmbedding(input: any): number[] {
    if (!Array.isArray(input)) {
      throw new BadRequestException("embedding must be an array");
    }

    const arr = input.map((x) => Number(x));

    if (arr.length < 64) {
      throw new BadRequestException("embedding too short");
    }

    if (arr.some((x) => !Number.isFinite(x))) {
      throw new BadRequestException("embedding contains invalid numbers");
    }

    return arr;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return -1;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return -1;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async enrollFace(userId: number, embeddingInput: any) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException("User not found");

    const embedding = this.parseEmbedding(embeddingInput);

    let profile = await this.faceRepo.findOne({ where: { userId } });

    if (!profile) {
      profile = this.faceRepo.create({
        userId,
        embeddingJson: JSON.stringify(embedding),
        isActive: true,
      });
    } else {
      profile.embeddingJson = JSON.stringify(embedding);
      profile.isActive = true;
    }

    await this.faceRepo.save(profile);

    return {
      success: true,
      enrolled: true,
      userId: user.id,
      username: user.username,
    };
  }

  async identifyByFace(embeddingInput: any) {
    const probe = this.parseEmbedding(embeddingInput);

    const profiles = await this.faceRepo.find({ where: { isActive: true } });
    if (!profiles.length) {
      throw new UnauthorizedException("No enrolled face profiles");
    }

    let best: { userId: number; score: number } | null = null;

    for (const p of profiles) {
      let stored: number[];
      try {
        stored = JSON.parse(p.embeddingJson);
      } catch {
        continue;
      }

      const score = this.cosineSimilarity(probe, stored);
      if (!best || score > best.score) {
        best = { userId: p.userId, score };
      }
    }

    if (!best || best.score < this.MATCH_THRESHOLD) {
      throw new UnauthorizedException("Face not recognized");
    }

    const user = await this.usersService.findById(best.userId);
    if (!user) throw new UnauthorizedException("Matched user not found");

    return {
      matched: true,
      score: Number(best.score.toFixed(4)),
      threshold: this.MATCH_THRESHOLD,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  async faceLoginWithPassword(body: { embedding: number[]; password: string }) {
    const password = String(body?.password || "");
    if (!password) throw new BadRequestException("Password is required");

    // Identify candidate first
    const identified = await this.identifyByFace(body.embedding);

    const user = await this.usersService.findById(identified.user.id);
    if (!user) throw new UnauthorizedException("User not found");

    // Verify this identified user's password
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    // Reuse your normal validate() to enforce lock rules and keep behavior consistent
    const validatedUser = await this.authService.validate(user.username, password);

    // Reuse normal sign() to return same token + permissions + language
    return this.authService.sign(validatedUser);
  }

  async disableFace(userId: number) {
    const profile = await this.faceRepo.findOne({ where: { userId } });
    if (!profile) return { success: true, disabled: false, reason: "No profile found" };

    profile.isActive = false;
    await this.faceRepo.save(profile);

    return { success: true, disabled: true, userId };
  }
}