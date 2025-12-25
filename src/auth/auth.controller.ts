import { Body, Controller, ForbiddenException, Post, UseGuards, Request, Get } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { UsersService } from "../user/user.service";

import { JwtAuthGuard } from "./jwt-auth.guard";
import { PermissionsGuard } from "./permissions.guard";
import { RequirePerms } from "./permissions.decorator";

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService, private users: UsersService) {}


@Get("state")
async state() {
  return this.auth.getPublicState();
}

  @Post("signup")
  async signup(@Body() body: { username: string; password: string }) {
    const user = await this.users.createUser(body.username, body.password, "USER", []);
    return await this.auth.sign(user); // ✅ await
  }

  @Post("login")
  async login(@Body() body: { username: string; password: string }) {
    const user = await this.auth.validate(body.username, body.password);
    return await this.auth.sign(user); // ✅ await
  }

  @Post("bootstrap-admin")
  async bootstrapAdmin(@Body() body: any) {
    const expectedRaw = process.env.BOOTSTRAP_SECRET;
    const expected = (expectedRaw || "").trim();
    const received = (body?.secret || "").trim();

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

    const admin = await this.users.createUser(
      body.username,
      body.password,
      "ADMIN",
      ["users.manage"]
    );

    return await this.auth.sign(admin); 
  }

  // ✅ NEW: logout all users
  @Post("logout-all")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms("users.manage")
  async logoutAll() {
    return this.auth.logoutAllUsers();
  }

  @Post("logout-user")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePerms("users.manage")
async logoutUser(@Body() body: { userId: number }) {
  return this.auth.logoutOneUser(body.userId);
}

// ✅ lock system (only admins with users.manage)
@Post("lock")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePerms("users.manage")
async lock(@Request() req: any, @Body() body: { allowedUserId?: number }) {
  // default: lock to the admin who pressed the button
  const allowedUserId = body?.allowedUserId ?? req.user.userId;
  return this.auth.lockSystem(allowedUserId);
}

// ✅ unlock system
@Post("unlock")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePerms("users.manage")
async unlock() {
  return this.auth.unlockSystem();
}
@Post("unlock-with-secret")
async unlockWithSecret(@Body() body: { secret: string }) {
  const expected = (process.env.BOOTSTRAP_SECRET || "").trim();
  const received = (body?.secret || "").trim();
  if (!expected || received !== expected) throw new ForbiddenException("Invalid secret");

  return this.auth.unlockSystem();
}




}
