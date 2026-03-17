// src/company/company.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Company } from "../entities/company.entity";

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>
  ) {}

  async create(companyName: string): Promise<Company> {
    const company = this.companyRepository.create({ companyName, isActive: false });
    return this.companyRepository.save(company);
  }

  async findAll(): Promise<Company[]> {
    return this.companyRepository.find();
  }

  async findOne(id: number): Promise<Company> {
    const company = await this.companyRepository.findOne({ where: { id } });
    if (!company) throw new NotFoundException(`Company #${id} not found`);
    return company;
  }

  async update(id: number, companyName: string): Promise<Company> {
    await this.findOne(id);
    await this.companyRepository.update(id, { companyName });
    return this.findOne(id);
  }

  async setVatInclusive(id: number, vatInclusive: boolean): Promise<Company> {
  await this.findOne(id); // throws if not found
  await this.companyRepository.update(id, { vatInclusive });
  return this.findOne(id);
}

  async setActive(id: number): Promise<Company> {
    await this.findOne(id); // throws if not found
    // deactivate all
    await this.companyRepository.update({}, { isActive: false });
    // activate the selected one
    await this.companyRepository.update(id, { isActive: true });
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    await this.companyRepository.delete(id);
  }
  async getActiveCompany(): Promise<Company> {
  const company = await this.companyRepository.findOne({ where: { isActive: true } });
  if (!company) throw new NotFoundException('No active company found');
  return company;
}
}