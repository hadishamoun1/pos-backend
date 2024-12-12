import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';

@Injectable()
export class BranchService {
  constructor(
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
  ) {}

  async create(branchName: string): Promise<Branch> {
    const branch = this.branchRepository.create({ branchName });
    return await this.branchRepository.save(branch);
  }

  async findAll(): Promise<Branch[]> {
    return await this.branchRepository.find();
  }

  async findOne(id: number): Promise<Branch> {
    return await this.branchRepository.findOneBy({ id });
  }

  async update(id: number, branchName: string): Promise<Branch> {
    const branch = await this.branchRepository.findOneBy({ id });
    if (branch) {
      branch.branchName = branchName;
      return await this.branchRepository.save(branch);
    }
    throw new Error('Branch not found');
  }

  async delete(id: number): Promise<void> {
    await this.branchRepository.delete(id);
  }
}
