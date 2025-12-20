// src/auth/auth.controller.ts
import { Body, Controller, ForbiddenException, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { UsersService } from "../user/user.service";

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService, private users: UsersService) {}

  @Post("signup")
  async signup(@Body() body: { username: string; password: string }) {
    // for now: default role/permissions (you can customize later)
    const user = await this.users.createUser(body.username, body.password, "USER", []);
    return this.auth.sign(user); // auto-login return token
  }

  @Post("login")
  async login(@Body() body: { username: string; password: string }) {
    const user = await this.auth.validate(body.username, body.password);
    return this.auth.sign(user);
  }
@Post("bootstrap-admin")
async bootstrapAdmin(@Body() body: any) {
  const expectedRaw = process.env.BOOTSTRAP_SECRET;
  const expected = (expectedRaw || "").trim();
  const received = (body?.secret || "").trim();

  // TEMP DEBUG (remove after)
  if (received !== expected) {
    throw new ForbiddenException({
      message: "Invalid bootstrap secret",
      expectedLoaded: !!expectedRaw,
      expectedLen: expected.length,
      receivedLen: received.length,
      receivedType: typeof body?.secret,
    });
  }

  const hasAdmin = await this.users.hasAnyAdmin();
  if (hasAdmin) throw new ForbiddenException("Admin already exists");

  const admin = await this.users.createUser(body.username, body.password, "ADMIN", ["users.manage"]);
  return this.auth.sign(admin);
}

}
