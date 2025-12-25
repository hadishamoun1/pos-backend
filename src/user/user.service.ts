// src/users/users.service.ts
import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User } from "../entities/user.entity";

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  findByUsername(username: string) {
    return this.repo.findOne({ where: { username } });
  }

  findById(id: number) {
    return this.repo.findOne({ where: { id } });
  }

  async createUser(username: string, password: string, role = "USER", permissions: string[] = []) {
    const exists = await this.findByUsername(username);
    if (exists) throw new BadRequestException("Username already exists");

    const passwordHash = await bcrypt.hash(password, 10);

    const user = this.repo.create({ username, passwordHash, role, permissions });
    return this.repo.save(user);
  }


  async listUsersSafe() {
  return this.repo.find({
    select: ["id", "username", "role", "permissions"], // no passwordHash
    order: { id: "ASC" },
  });
}

async setPermissions(userId: number, permissions: string[]) {
  const user = await this.repo.findOne({ where: { id: userId } });
  if (!user) throw new NotFoundException("User not found");

  user.permissions = permissions || [];
  const saved = await this.repo.save(user);

  // return safe fields
  return {
    id: saved.id,
    username: saved.username,
    role: saved.role,
    permissions: saved.permissions || [],
  };
}

async setRole(userId: number, role: string) {
  const user = await this.repo.findOne({ where: { id: userId } });
  if (!user) throw new NotFoundException("User not found");

  user.role = role;
  const saved = await this.repo.save(user);

  return {
    id: saved.id,
    username: saved.username,
    role: saved.role,
    permissions: saved.permissions || [],
  };
}
async updateUser(id: number, patch: Partial<User>) {
  await this.repo.update({ id }, patch);
  return this.repo.findOne({ where: { id } });
}



async hasAnyAdmin() {
  const count = await this.repo.count({ where: { role: "ADMIN" } });
  return count > 0;
}
}
