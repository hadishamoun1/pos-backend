// src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UsersService } from "../user/user.service";

@Injectable()
export class AuthService {
  constructor(private users: UsersService, private jwt: JwtService) {}

  async validate(username: string, password: string) {
    const user = await this.users.findByUsername(username);
    if (!user) throw new UnauthorizedException("Invalid credentials");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    return user;
  }

  sign(user: any) {
    // Put role + permissions inside the token so frontend can hide buttons easily
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions || [],
    };
    return { access_token: this.jwt.sign(payload) };
  }
}
