import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuthState } from "../entities/AuthState.entity";
import { UsersService } from "../user/user.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
     @InjectRepository(AuthState) private authStateRepo: Repository<AuthState>,
  private users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || "dev_secret_change_me",
    });
  }

async validate(payload: any) {
  // ✅ global check (already)
  const state = await this.authStateRepo.findOne({ where: { id: 1 } });
  const currentGver = state?.globalTokenVersion ?? 1;
  if ((payload?.gver ?? 1) !== currentGver) {
    throw new UnauthorizedException("Session expired. Please login again.");
  }

  // ✅ per-user check
  const dbUser = await this.users.findById(payload.sub);
  if (!dbUser) throw new UnauthorizedException("User not found");

  const currentUver = dbUser.tokenVersion ?? 1;
  if ((payload?.uver ?? 1) !== currentUver) {
    throw new UnauthorizedException("Session expired. Please login again.");
  }

  return {
    userId: payload.sub,
    username: payload.username,
    role: payload.role,
    permissions: payload.permissions || [],
  };
}

}
