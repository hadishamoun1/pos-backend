import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { GroupService } from './group.service';
import { Group } from '../entities/group.entity';

@Controller('groups')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @Get()
  findAll() {
    return this.groupService.findAll();
  }

  @Get(':groupCode')
  findOne(@Param('groupCode') groupCode: string) {
    return this.groupService.findOne(groupCode);
  }

  @Post()
  create(@Body() group: Group) {
    return this.groupService.create(group);
  }

  @Put(':groupCode')
  update(@Param('groupCode') groupCode: string, @Body() group: Partial<Group>) {
    return this.groupService.update(groupCode, group);
  }

  @Delete(':groupCode')
  delete(@Param('groupCode') groupCode: string) {
    return this.groupService.delete(groupCode);
  }
}
