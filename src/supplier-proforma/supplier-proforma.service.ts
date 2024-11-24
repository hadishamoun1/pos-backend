import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { SupplierProforma } from '../entities/supplierProforma.entity';
import { SupplierProformaItem } from '../entities/supplierProformaItem.entity';
import { Settings } from '../entities/settings.entity';

@Injectable()
export class SupplierProformaService {
  constructor(
    @InjectRepository(SupplierProforma)
    private readonly supplierProformaRepository: Repository<SupplierProforma>,
    @InjectRepository(SupplierProformaItem)
    private readonly supplierProformaItemRepository: Repository<SupplierProformaItem>,
    @InjectRepository(Settings)
    private readonly settingsRepository: Repository<Settings>,
  ) {}

  async create(
    proformaData: Partial<SupplierProforma> & {
      items?: Partial<SupplierProformaItem>[];
    },
  ): Promise<SupplierProforma> {
    const { items = [], ...proformaMetadata } = proformaData;

    // Generate the proforma number
    const proformaNumber = await this.generateProformaNumber();
    const proforma = this.supplierProformaRepository.create({
      ...proformaMetadata,
      proformaNumber,
    });

    // Add items to the proforma
    proforma.items = items.map((item) =>
      this.supplierProformaItemRepository.create(item),
    );

    // Save the proforma and its items
    return this.supplierProformaRepository.save(proforma);
  }

  async findAll(): Promise<SupplierProforma[]> {
    return this.supplierProformaRepository.find({ relations: ['items'] });
  }

  async findOne(id: number): Promise<SupplierProforma> {
    const proforma = await this.supplierProformaRepository.findOne({
      where: { id },
      relations: ['items'],
    });

    if (!proforma) {
      throw new NotFoundException(`SupplierProforma with ID ${id} not found`);
    }

    return proforma;
  }

  async update(
    id: number,
    updateData: Partial<SupplierProforma> & {
      items?: Partial<SupplierProformaItem>[];
    },
  ): Promise<SupplierProforma> {
    const existingProforma = await this.findOne(id); // Ensure the proforma exists

    const { items, ...metadata } = updateData;

    // Update proforma metadata
    await this.supplierProformaRepository.update(id, metadata);

    // Update items
    if (items) {
      await this.supplierProformaItemRepository.delete({
        proforma: existingProforma,
      });
      const newItems = items.map((item) =>
        this.supplierProformaItemRepository.create(item),
      );
      await this.supplierProformaItemRepository.save(newItems);
    }

    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    const proforma = await this.findOne(id); // Ensure the proforma exists
    await this.supplierProformaRepository.remove(proforma);
  }

  private async generateProformaNumber(): Promise<string> {
    const settings = await this.settingsRepository.findOne({
      where: { isActive: true },
    });

    if (!settings) {
      throw new NotFoundException(
        'Active year is not set in the settings table',
      );
    }

    const activeYear = settings.year.toString().slice(-2);

    const lastProforma = await this.supplierProformaRepository.findOne({
      where: { proformaNumber: Like(`PR${activeYear}-%`) },
      order: { id: 'DESC' },
    });

    const lastNumber = lastProforma
      ? parseInt(lastProforma.proformaNumber.split('-')[1], 10)
      : 0;

    return `PR${activeYear}-${lastNumber + 1}`;
  }
}
