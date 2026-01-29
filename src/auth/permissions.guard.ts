// src/auth/permissions.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMS_KEY } from "./permissions.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(PERMS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;

    // ✅ allow admins always
    if (user?.role === "ADMIN") return true;

    const perms: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    const ok = required.every((p) => perms.includes(p));

    if (!ok) throw new ForbiddenException("Not allowed");
    return true;
  }
}
