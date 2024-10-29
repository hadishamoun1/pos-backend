import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { UserService } from './user.service';
import { User } from '../entities/user.entity';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  create(
    @Body() body: { username: string; password: string; role: string },
  ): Promise<User> {
    return this.userService.create(body.username, body.password, body.role);
  }

  @Get()
  findAll(): Promise<User[]> {
    return this.userService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: number): Promise<User> {
    return this.userService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id') id: number,
    @Body() body: { username: string; password: string; role: string },
  ): Promise<User> {
    return this.userService.update(id, body.username, body.password, body.role);
  }

  @Delete(':id')
  delete(@Param('id') id: number): Promise<void> {
    return this.userService.delete(id);
  }
}
