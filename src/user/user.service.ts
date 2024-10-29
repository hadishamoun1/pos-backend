import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(
    username: string,
    password: string,
    role: string,
  ): Promise<User> {
    const newUser = this.userRepository.create({ username, password, role });
    return this.userRepository.save(newUser);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find();
  }

  async findOne(id: number): Promise<User> {
    return this.userRepository.findOne({ where: { id } });
  }

  async update(
    id: number,
    username: string,
    password: string,
    role: string,
  ): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    user.username = username;
    user.password = password;
    user.role = role;
    return this.userRepository.save(user);
  }

  async delete(id: number): Promise<void> {
    await this.userRepository.delete(id);
  }
}
