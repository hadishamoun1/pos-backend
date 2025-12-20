// src/auth/auth.module.ts
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";

import { UserModule } from "../user/user.module";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";

// Optional: if you want to provide these globally via module DI (not required)
// import { PermissionsGuard } from "./permissions.guard";

@Module({
  imports: [
    UserModule,
    PassportModule,
 JwtModule.register({
  secret: process.env.JWT_SECRET || "dev_secret_change_me",
  signOptions: { expiresIn: "7d" },
})

  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
