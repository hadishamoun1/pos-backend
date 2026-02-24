import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UseGuards,
  Request,
  Get,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { UsersService } from "../user/user.service"; // <-- if your folder is ../users, change this

import { JwtAuthGuard } from "./jwt-auth.guard";
import { PermissionsGuard } from "./permissions.guard";
import { RequirePerms } from "./permissions.decorator";
import { FaceAuthService } from "../face-auth/face-auth.service";

@Controller("auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    private users: UsersService,
    private faceAuth: FaceAuthService,
  ) {}

  @Get("state")
  async state() {
    return this.auth.getPublicState();
  }

  @Post("signup")
  async signup(@Body() body: { username: string; password: string }) {
    const user = await this.users.createUser(body.username, body.password, "USER", []);
    return await this.auth.sign(user);
  }

  @Post("login")
  async login(@Body() body: { username: string; password: string }) {
    const user = await this.auth.validate(body.username, body.password);
    return await this.auth.sign(user);
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

  // =========================================================
  // FACE AUTH (v1 = face identify + password confirm)
  // =========================================================

  // Admin enroll/update face embedding for a user
  @Post("face/enroll")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms("users.manage")
  async enrollFace(@Body() body: { userId: number; embedding: number[] }) {
    return this.faceAuth.enrollFace(Number(body.userId), body.embedding);
  }

  // Optional admin endpoint to disable a user's face login
  @Post("face/disable")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms("users.manage")
  async disableFace(@Body() body: { userId: number }) {
    return this.faceAuth.disableFace(Number(body.userId));
  }

  // Identify who the face belongs to (does not login yet)
  @Post("face/identify")
  async faceIdentify(@Body() body: { embedding: number[] }) {
    return this.faceAuth.identifyByFace(body.embedding);
  }

  // Final login = face match + password
  @Post("face/login")
  async faceLogin(@Body() body: { embedding: number[]; password: string }) {
    return this.faceAuth.faceLoginWithPassword(body);
  }

  @Post("face/enroll-me")
@UseGuards(JwtAuthGuard)
async enrollMyFace(
  @Request() req: any,
  @Body() body: { embedding: number[] }
) {
  const userId = Number(req.user?.userId || req.user?.sub);
  return this.faceAuth.enrollFace(userId, body.embedding);
}
}