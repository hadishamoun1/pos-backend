import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { SupplierProforma } from '../entities/supplierProforma.entity';
import { Settings } from '../entities/settings.entity'; // Assuming you have a Settings entity

@Injectable()
export class SupplierProformaService {
  constructor(
    @InjectRepository(SupplierProforma)
    private readonly supplierProformaRepository: Repository<SupplierProforma>,
    @InjectRepository(Settings)
    private readonly settingsRepository: Repository<Settings>,
  ) {}

  async create(
    supplierProformaData: Partial<SupplierProforma>,
  ): Promise<SupplierProforma> {
    // Generate the proforma number
    const proformaNumber = await this.generateProformaNumber();
    const supplierProforma = this.supplierProformaRepository.create({
      ...supplierProformaData,
      proformaNumber,
    });
    return this.supplierProformaRepository.save(supplierProforma);
  }

  async findAll(): Promise<SupplierProforma[]> {
    return this.supplierProformaRepository.find();
  }

  async findOne(id: number): Promise<SupplierProforma> {
    const supplierProforma = await this.supplierProformaRepository.findOne({
      where: { id },
    });
    if (!supplierProforma) {
      throw new NotFoundException(`SupplierProforma with ID ${id} not found`);
    }
    return supplierProforma;
  }

  async update(
    id: number,
    updateData: Partial<SupplierProforma>,
  ): Promise<SupplierProforma> {
    await this.findOne(id); // Ensure the entity exists
    await this.supplierProformaRepository.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id); // Ensure the entity exists
    await this.supplierProformaRepository.delete(id);
  }

  private async generateProformaNumber(): Promise<string> {
    // Fetch the active year from the settings table
    const settings = await this.settingsRepository.findOne({
      where: { isActive: true },
    });

    if (!settings) {
      throw new NotFoundException(
        'Active year is not set in the settings table',
      );
    }

    const activeYear = settings.year.toString().slice(-2); // Get the last two digits of the year (e.g., '24')

    // Find the last proforma for the active year
    const lastProforma = await this.supplierProformaRepository.findOne({
      where: { proformaNumber: Like(`PR${activeYear}-%`) },
      order: { id: 'DESC' }, // Order by ID descending to get the last one
    });

    // Extract the last number and increment it
    const lastNumber = lastProforma
      ? parseInt(lastProforma.proformaNumber.split('-')[1], 10)
      : 0;

    const nextNumber = lastNumber + 1;

    // Return the new proforma number
    return `PR${activeYear}-${nextNumber}`;
  }
}
