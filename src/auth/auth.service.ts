import { Injectable, NotFoundException, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UsersService } from "../user/user.service";

import { InjectRepository } from "@nestjs/typeorm";      
import { Repository } from "typeorm";                    
import { AuthState } from "../entities/AuthState.entity";



@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    @InjectRepository(AuthState) private authStateRepo: Repository<AuthState>, 
  ) {}

async validate(username: string, password: string) {
  const user = await this.users.findByUsername(username);
  if (!user) throw new UnauthorizedException("Invalid credentials");

  // ✅ BLOCK LOGIN IF SYSTEM LOCKED (except allowed user)
  let state = await this.authStateRepo.findOne({ where: { id: 1 } });
  if (!state) {
    state = this.authStateRepo.create({
      id: 1,
      globalTokenVersion: 1,
      isLocked: false,
      lockAllowedUserId: null,
    });
    state = await this.authStateRepo.save(state);
  }

  if (state.isLocked) {
    const allowedId = state.lockAllowedUserId;
    if (!allowedId || user.id !== allowedId) {
      throw new ForbiddenException("System is locked. Only the allowed admin can login.");
    }
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new UnauthorizedException("Invalid credentials");

  return user;
}


  private async getGlobalTokenVersion(): Promise<number> {
    let state = await this.authStateRepo.findOne({ where: { id: 1 } });
    if (!state) {
      state = this.authStateRepo.create({ id: 1, globalTokenVersion: 1 });
      state = await this.authStateRepo.save(state);
    }
    return state.globalTokenVersion || 1;
  }

  async sign(user: any) {
    const gver = await this.getGlobalTokenVersion(); // ✅

    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions || [],
      gver, 
       uver: user.tokenVersion || 1,
    };

    return { access_token: this.jwt.sign(payload) };
  }

  // ✅ logout everyone
  async logoutAllUsers() {
    let state = await this.authStateRepo.findOne({ where: { id: 1 } });
    if (!state) {
      state = this.authStateRepo.create({ id: 1, globalTokenVersion: 1 });
    }
    state.globalTokenVersion = (state.globalTokenVersion || 1) + 1;
    await this.authStateRepo.save(state);
    return { success: true, globalTokenVersion: state.globalTokenVersion };
  }



async logoutOneUser(userId: number) {
  const user = await this.users.findById(userId);
  if (!user) throw new NotFoundException("User not found");

  const nextVersion = (user.tokenVersion || 1) + 1;

  // ✅ update without save()
  await this.users.updateUser(userId, { tokenVersion: nextVersion });

  return { success: true, userId, tokenVersion: nextVersion };
}


async lockSystem(allowedUserId: number) {
  let state = await this.authStateRepo.findOne({ where: { id: 1 } });
  if (!state) {
    state = this.authStateRepo.create({
      id: 1,
      globalTokenVersion: 1,
      isLocked: false,
      lockAllowedUserId: null,
    });
  }

  // ✅ invalidate all tokens
  state.globalTokenVersion = (state.globalTokenVersion || 1) + 1;

  // ✅ lock
  state.isLocked = true;
  state.lockAllowedUserId = allowedUserId;

  await this.authStateRepo.save(state);

  return {
    success: true,
    isLocked: true,
    lockAllowedUserId: state.lockAllowedUserId,
    globalTokenVersion: state.globalTokenVersion,
  };
}

async unlockSystem() {
  let state = await this.authStateRepo.findOne({ where: { id: 1 } });
  if (!state) {
    state = this.authStateRepo.create({
      id: 1,
      globalTokenVersion: 1,
      isLocked: false,
      lockAllowedUserId: null,
    });
    await this.authStateRepo.save(state);
    return { success: true, isLocked: false };
  }

  state.isLocked = false;
  state.lockAllowedUserId = null;
  await this.authStateRepo.save(state);

  return { success: true, isLocked: false };
}

async getPublicState() {
  let state = await this.authStateRepo.findOne({ where: { id: 1 } });

  if (!state) {
    state = this.authStateRepo.create({
      id: 1,
      globalTokenVersion: 1,
      isLocked: false,
      lockAllowedUserId: null,
    });
    state = await this.authStateRepo.save(state);
  }

  return {
    isLocked: !!state.isLocked,
    lockAllowedUserId: state.lockAllowedUserId ?? null,
    globalTokenVersion: state.globalTokenVersion || 1,
  };
}

}
