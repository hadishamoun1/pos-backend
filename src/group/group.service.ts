import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from '../entities/group.entity';

@Injectable()
export class GroupService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
  ) {}

  findAll() {
    return this.groupRepository.find();
  }

  findOne(groupCode: string) {
    return this.groupRepository.findOneBy({ groupCode });
  }

  create(group: Group) {
    return this.groupRepository.save(group);
  }

  update(groupCode: string, group: Partial<Group>) {
    return this.groupRepository.update(groupCode, group);
  }

  delete(groupCode: string) {
    return this.groupRepository.delete(groupCode);
  }
}
