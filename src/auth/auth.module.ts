import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm"; // ✅ add

import { UserModule } from "../user/user.module";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";

import { AuthState } from "../entities/AuthState.entity";

@Module({
  imports: [
    UserModule,
    PassportModule,
    TypeOrmModule.forFeature([AuthState]), 
    JwtModule.register({
      secret: process.env.JWT_SECRET || "dev_secret_change_me",
      signOptions: { expiresIn: "7d" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
