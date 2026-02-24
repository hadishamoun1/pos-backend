import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";

import { UserModule } from "../user/user.module"; // <-- if your folder is ../users, change this
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";

import { AuthState } from "../entities/AuthState.entity";
import { FaceProfile } from "../entities/face-profile.entity";
import { FaceAuthService } from "../face-auth/face-auth.service";

@Module({
  imports: [
    UserModule,
    PassportModule,
    TypeOrmModule.forFeature([AuthState, FaceProfile]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || "dev_secret_change_me",
      signOptions: { expiresIn: "7d" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, FaceAuthService],
  exports: [AuthService],
})
export class AuthModule {}